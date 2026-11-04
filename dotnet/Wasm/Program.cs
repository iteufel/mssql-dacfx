using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;
using MssqlDac;

return;

[SupportedOSPlatform("browser")]
public static partial class JsExports
{
    [JSExport]
    public static Task<string> Invoke(string request) => Task.Run(() => Bridge.Invoke(request));
}
