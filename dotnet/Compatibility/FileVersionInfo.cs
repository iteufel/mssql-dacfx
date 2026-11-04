using System.Reflection;
using System.Runtime.CompilerServices;

namespace System.Diagnostics;

/// <summary>
/// Version metadata for managed assemblies already loaded in the WASM runtime.
/// The framework's browser implementation throws PlatformNotSupportedException.
/// DacFx uses this API to record the producing assembly in package origin metadata.
/// </summary>
public sealed class FileVersionInfo
{
    private readonly Assembly assembly;
    private readonly Version fileVersion;
    private readonly Version productVersion;

    private FileVersionInfo(string fileName, Assembly caller)
    {
        ArgumentNullException.ThrowIfNull(fileName);
        FileName = fileName;
        // Assemblies loaded from WebCIL have an empty Location. In that case,
        // use the caller's actual metadata, never an invented product version.
        assembly = fileName.Length == 0 ? caller
            : AppDomain.CurrentDomain.GetAssemblies().FirstOrDefault(candidate =>
                string.Equals(candidate.Location, fileName, StringComparison.Ordinal)
                || string.Equals(candidate.GetName().Name, Path.GetFileNameWithoutExtension(fileName), StringComparison.OrdinalIgnoreCase))
                ?? throw new FileNotFoundException("Version metadata is available only for loaded managed assemblies.", fileName);
        fileVersion = ParseVersion(FileVersion);
        productVersion = ParseVersion(ProductVersion);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    public static FileVersionInfo GetVersionInfo(string fileName) => new(fileName, Assembly.GetCallingAssembly());

    public string FileName { get; }
    public string? FileVersion => assembly.GetCustomAttribute<AssemblyFileVersionAttribute>()?.Version;
    public string? ProductVersion => assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
        ?? assembly.GetName().Version?.ToString();
    public string? CompanyName => assembly.GetCustomAttribute<AssemblyCompanyAttribute>()?.Company;
    public string? ProductName => assembly.GetCustomAttribute<AssemblyProductAttribute>()?.Product;
    public string? FileDescription => assembly.GetCustomAttribute<AssemblyTitleAttribute>()?.Title;
    public string? Comments => assembly.GetCustomAttribute<AssemblyDescriptionAttribute>()?.Description;
    public string? LegalCopyright => assembly.GetCustomAttribute<AssemblyCopyrightAttribute>()?.Copyright;
    public string? LegalTrademarks => assembly.GetCustomAttribute<AssemblyTrademarkAttribute>()?.Trademark;
    public string InternalName => assembly.GetName().Name + ".dll";
    public string OriginalFilename => InternalName;
    public string Language => "Language Neutral";
    public string PrivateBuild => "";
    public string SpecialBuild => "";
    public bool IsDebug => assembly.GetCustomAttribute<DebuggableAttribute>()?.IsJITTrackingEnabled ?? false;
    public bool IsPatched => false;
    public bool IsPreRelease => false;
    public bool IsPrivateBuild => false;
    public bool IsSpecialBuild => false;
    public int FileMajorPart => fileVersion.Major;
    public int FileMinorPart => fileVersion.Minor;
    public int FileBuildPart => fileVersion.Build;
    public int FilePrivatePart => fileVersion.Revision;
    public int ProductMajorPart => productVersion.Major;
    public int ProductMinorPart => productVersion.Minor;
    public int ProductBuildPart => productVersion.Build;
    public int ProductPrivatePart => productVersion.Revision;

    private static Version ParseVersion(string? value)
    {
        var parts = (value ?? "").Split('.');
        var numbers = new int[4];
        for (var i = 0; i < Math.Min(parts.Length, numbers.Length); i++)
        {
            var digits = new string(parts[i].TakeWhile(char.IsAsciiDigit).ToArray());
            if (!int.TryParse(digits, out numbers[i])) break;
        }
        return new Version(numbers[0], numbers[1], numbers[2], numbers[3]);
    }

    public override string ToString() => $"File: {FileName}\nFileVersion: {FileVersion}\nProductVersion: {ProductVersion}";
}
