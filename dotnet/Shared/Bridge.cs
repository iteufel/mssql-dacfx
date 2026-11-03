using System.Text.Json;
using Microsoft.SqlServer.Dac;
using Microsoft.SqlServer.Dac.Model;

namespace MssqlDac;

public static class Bridge
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static string Invoke(string request)
    {
        try
        {
            var input = JsonSerializer.Deserialize<Request>(request, Json)
                ?? throw new ArgumentException("A request is required.");
            object result = input.Operation switch
            {
                "validate" => Validate(input),
                "build" => Build(input),
                "inspect" => Inspect(input),
                "createScript" => CreateScript(input),
                "deployScript" => Compare(input, false),
                "deployReport" => Compare(input, true),
                _ => throw new ArgumentException($"Unknown operation: {input.Operation}")
            };
            return JsonSerializer.Serialize(new { ok = true, result }, Json);
        }
        catch (Exception error)
        {
            return JsonSerializer.Serialize(new
            {
                ok = false,
                error = new
                {
                    code = error is SchemaException ? "SCHEMA_INVALID" : error.GetType().Name,
                    message = error.Message,
                    diagnostics = error is SchemaException schema ? schema.Diagnostics : []
                }
            }, Json);
        }
    }

    private static TSqlModel CreateModel(Request input, out List<Diagnostic> diagnostics)
    {
        if (!Enum.TryParse<SqlServerVersion>(input.TargetVersion, false, out var version)
            || !Enum.IsDefined(version))
            throw new ArgumentException($"Unsupported targetVersion: {input.TargetVersion}");
        var options = new TSqlModelOptions();
        if (input.Collation is not null) options.Collation = input.Collation;
        var model = new TSqlModel(version, options);
        diagnostics = [];
        try
        {
            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var file in input.Files)
            {
                if (string.IsNullOrWhiteSpace(file.Name) || !names.Add(file.Name))
                    throw new ArgumentException("SQL source names must be nonempty and unique.");
                try { model.AddOrUpdateObjects(file.Sql, file.Name, new TSqlObjectOptions()); }
                catch (DacModelException error)
                {
                    diagnostics.AddRange(error.Messages.Select(message => ToDiagnostic(message, file.Name)));
                }
            }
            diagnostics.AddRange(model.Validate().Select(message => ToDiagnostic(message)));
            return model;
        }
        catch { model.Dispose(); throw; }
    }

    private static Diagnostic ToDiagnostic(DacModelMessage message, string? source = null) => new(
        message.Number, message.MessageType.ToString().ToLowerInvariant(), message.Message,
        source, 0, 0);

    private static object Validate(Request input)
    {
        using var model = CreateModel(input, out var diagnostics);
        return new { valid = !diagnostics.Any(d => d.Severity == "error"), diagnostics };
    }

    private static object Build(Request input)
    {
        using var model = CreateModel(input, out var diagnostics);
        if (diagnostics.Any(d => d.Severity == "error")) throw new SchemaException(diagnostics);
        using var stream = new MemoryStream();
        DacPackageExtensions.BuildPackage(stream, model, new PackageMetadata
        {
            Name = input.Name,
            Version = input.Version,
            Description = input.Description
        });
        return new { dacpac = Convert.ToBase64String(stream.ToArray()), diagnostics };
    }

    private static MemoryStream Bytes(string? value) => new(Convert.FromBase64String(
        value ?? throw new ArgumentException("DACPAC bytes are required.")), false);

    private static object Inspect(Request input)
    {
        using var stream = Bytes(input.Dacpac);
        using var package = DacPackage.Load(stream, DacSchemaModelStorageType.Memory);
        stream.Position = 0;
        using var model = TSqlModel.LoadFromDacpac(stream, new ModelLoadOptions
        {
            LoadAsScriptBackedModel = true,
            ModelStorageType = DacSchemaModelStorageType.Memory
        });
        var objects = model.GetObjects(DacQueryScopes.UserDefined)
            .Where(item => item.Name.HasName)
            .Select(item => new
            {
                name = item.Name.ToString(),
                type = item.ObjectType.Name,
                script = item.TryGetScript(out var sql) ? sql : null
            }).OrderBy(item => item.name, StringComparer.Ordinal).ThenBy(item => item.type).ToArray();
        return new { package.Name, version = package.Version.ToString(), package.Description,
            targetVersion = model.Version.ToString(), objects };
    }

    private static DacDeployOptions Options(Request input) => new()
    {
        BlockOnPossibleDataLoss = input.DeployOptions.BlockOnPossibleDataLoss,
        DropObjectsNotInSource = input.DeployOptions.DropObjectsNotInSource,
        IgnorePermissions = input.DeployOptions.IgnorePermissions,
        IgnoreRoleMembership = input.DeployOptions.IgnoreRoleMembership,
        IncludeCompositeObjects = input.DeployOptions.IncludeCompositeObjects
    };

    private static object CreateScript(Request input)
    {
        using var stream = Bytes(input.Dacpac);
        using var package = DacPackage.Load(stream, DacSchemaModelStorageType.Memory);
        return DacServices.GenerateCreateScript(package, input.DatabaseName, Options(input));
    }

    private static object Compare(Request input, bool report)
    {
        using var sourceStream = Bytes(input.Source);
        using var targetStream = Bytes(input.Target);
        using var source = DacPackage.Load(sourceStream, DacSchemaModelStorageType.Memory);
        using var target = DacPackage.Load(targetStream, DacSchemaModelStorageType.Memory);
        return report
            ? DacServices.GenerateDeployReport(source, target, input.DatabaseName, Options(input))
            : DacServices.GenerateDeployScript(source, target, input.DatabaseName, Options(input));
    }
}

public sealed class Request
{
    public string Operation { get; set; } = "";
    public SqlFile[] Files { get; set; } = [];
    public string TargetVersion { get; set; } = "Sql160";
    public string? Collation { get; set; }
    public string Name { get; set; } = "Database";
    public string Version { get; set; } = "1.0.0.0";
    public string Description { get; set; } = "";
    public string? Dacpac { get; set; }
    public string? Source { get; set; }
    public string? Target { get; set; }
    public string DatabaseName { get; set; } = "Database";
    public DeployOptions DeployOptions { get; set; } = new();
}

public sealed record SqlFile(string Name, string Sql);
public sealed record Diagnostic(int Code, string Severity, string Message, string? SourceName, int Line, int Column);
public sealed class SchemaException(List<Diagnostic> diagnostics) : Exception("The SQL schema contains errors.")
{
    public List<Diagnostic> Diagnostics { get; } = diagnostics;
}
public sealed class DeployOptions
{
    public bool BlockOnPossibleDataLoss { get; set; } = true;
    public bool DropObjectsNotInSource { get; set; }
    public bool IgnorePermissions { get; set; }
    public bool IgnoreRoleMembership { get; set; }
    public bool IncludeCompositeObjects { get; set; }
}
