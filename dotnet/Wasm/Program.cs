using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;
using MssqlDac;

return;

[SupportedOSPlatform("browser")]
public static partial class JsExports
{
    [JSExport]
    public static string Invoke(string request) => Bridge.Invoke(request);
}
