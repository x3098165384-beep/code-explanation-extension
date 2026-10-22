using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

// 只在明确的非交互测试窗口站读取测试结果，不写剪贴板或发送输入。
public static class ClipboardProbe {
    [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr GetThreadDesktop(uint id);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool GetUserObjectInformation(IntPtr h, int index, StringBuilder text, uint size, out uint needed);
    [DllImport("user32.dll", SetLastError = true)] static extern bool OpenClipboard(IntPtr window);
    [DllImport("user32.dll")] static extern bool CloseClipboard();
    [DllImport("user32.dll")] static extern IntPtr GetClipboardData(uint format);
    [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")] static extern IntPtr GetClipboardOwner();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr h);
    [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr h);

    static string Name(IntPtr h) {
        uint size; var text = new StringBuilder(512);
        if (h == IntPtr.Zero || !GetUserObjectInformation(h, 2, text, 1024, out size))
            throw new InvalidOperationException("Cannot inspect the test window station or desktop. Win32=" + Marshal.GetLastWin32Error());
        return text.ToString();
    }
    static string Json(string value) {
        var text = new StringBuilder("\"");
        foreach (char c in value) {
            if (c == '"' || c == '\\') text.Append('\\').Append(c);
            else if (c == '\n') text.Append("\\n");
            else if (c == '\r') text.Append("\\r");
            else if (c == '\t') text.Append("\\t");
            else if (c < 32) text.Append("\\u").Append(((int)c).ToString("x4"));
            else text.Append(c);
        }
        return text.Append('"').ToString();
    }
    public static void Main(string[] args) {
        Console.OutputEncoding = new UTF8Encoding(false);
        try {
            string station = Name(GetProcessWindowStation());
            if (args.Length < 2 || station != args[0] || station.Equals("WinSta0", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Refusing access outside the expected noninteractive test station.");
            if (args[1] == "identity") {
                Console.Write("{\"station\":" + Json(station) + ",\"desktop\":" + Json(Name(GetThreadDesktop(GetCurrentThreadId()))) + "}");
            } else if (args[1] == "process" || args[1] == "process-info") {
                var process = Process.GetProcessById(int.Parse(args[2]));
                var names = new StringBuilder("["); var errors = new StringBuilder("["); bool first = true, firstError = true;
                foreach (ProcessThread thread in process.Threads) {
                    try {
                        string name = Name(GetThreadDesktop((uint)thread.Id));
                        if (!first) names.Append(','); first = false; names.Append(Json(name));
                    } catch (Exception error) {
                        if (!firstError) errors.Append(','); firstError = false;
                        errors.Append("{\"threadId\":").Append(thread.Id).Append(",\"error\":").Append(Json(error.Message)).Append('}');
                    }
                }
                names.Append(']'); errors.Append(']');
                Console.Write(args[1] == "process" ? names.ToString() : "{\"desktops\":" + names + ",\"inspectionErrors\":" + errors + "}");
            } else if (args[1] == "read") {
                if (!OpenClipboard(IntPtr.Zero)) throw new InvalidOperationException("Cannot open the isolated clipboard.");
                try {
                    var memory = GetClipboardData(13); string text = "";
                    if (memory != IntPtr.Zero) {
                        var pointer = GlobalLock(memory);
                        try { text = Marshal.PtrToStringUni(pointer) ?? ""; }
                        finally { if (pointer != IntPtr.Zero) GlobalUnlock(memory); }
                    }
                    uint ownerProcess; uint ownerThread = GetWindowThreadProcessId(GetClipboardOwner(), out ownerProcess);
                    string ownerDesktop = ownerThread == 0 ? "" : Name(GetThreadDesktop(ownerThread));
                    Console.Write("{\"station\":" + Json(station) + ",\"sequence\":" + GetClipboardSequenceNumber() + ",\"ownerProcessId\":" + ownerProcess + ",\"ownerThreadDesktop\":" + Json(ownerDesktop) + ",\"text\":" + Json(text) + "}");
                } finally { CloseClipboard(); }
            } else throw new InvalidOperationException("Unknown test probe operation.");
        } catch (Exception error) { Console.Error.Write(error.Message); Environment.Exit(1); }
    }
}
