using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace CodeExplanationVerification {
    // 仅创建独立测试进程；没有切换桌面、激活窗口或发送输入的接口。
    public sealed class IsolatedDesktop : IDisposable {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct StartupInfo {
            public uint cb; public string reserved, desktop, title;
            public uint x, y, xSize, ySize, xChars, yChars, fill, flags;
            public short show; public ushort reservedSize;
            public IntPtr reservedBytes, input, output, error;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct ProcessInfo { public IntPtr process, thread; public uint processId, threadId; }
        [StructLayout(LayoutKind.Sequential)]
        struct StartupInfoEx { public StartupInfo info; public IntPtr attributes; }
        [StructLayout(LayoutKind.Sequential)]
        struct SecurityAttributes { public int size; public IntPtr descriptor; [MarshalAs(UnmanagedType.Bool)] public bool inherit; }
        [StructLayout(LayoutKind.Sequential)]
        struct BasicLimits {
            public long processTime, jobTime; public uint flags;
            public UIntPtr minimum, maximum; public uint activeProcesses;
            public UIntPtr affinity; public uint priority, scheduling;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct IoCounters { public ulong readCount, writeCount, otherCount, readBytes, writeBytes, otherBytes; }
        [StructLayout(LayoutKind.Sequential)]
        struct ExtendedLimits {
            public BasicLimits basic; public IoCounters io;
            public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory;
        }
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr CreateDesktop(string name, IntPtr device, IntPtr mode, uint flags, uint access, IntPtr security);
        [DllImport("user32.dll", SetLastError = true)] static extern bool CloseDesktop(IntPtr desktop);
        [DllImport("user32.dll", SetLastError = true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
        [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation();
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder data, uint length, out uint required);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool CreateProcess(string app, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity,
            bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInfo process);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr CreateFile(string path, uint access, uint share, ref SecurityAttributes security, uint creation, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
        [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr security, string name);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits info, uint length);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
        [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
        [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint code);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

        IntPtr desktopHandle, jobHandle, processHandle;
        public string DesktopName { get; private set; }
        public string InputDesktopBefore { get; private set; }
        public uint ProcessId { get; private set; }

        static string ObjectName(IntPtr handle) {
            if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            uint required;
            var name = new StringBuilder(512);
            if (!GetUserObjectInformation(handle, 2, name, 1024, out required)) throw new Win32Exception(Marshal.GetLastWin32Error());
            return name.ToString();
        }
        public static string InputDesktopName() {
            var handle = OpenInputDesktop(0, false, 1);
            try { return ObjectName(handle); } finally { if (handle != IntPtr.Zero) CloseDesktop(handle); }
        }
        static void Require(bool result) { if (!result) throw new Win32Exception(Marshal.GetLastWin32Error()); }

        public static IsolatedDesktop Start(string executable, string arguments, string directory, string outputFile) {
            var session = new IsolatedDesktop();
            try {
                session.InputDesktopBefore = InputDesktopName();
                session.DesktopName = "CodeExplanationTest_" + Guid.NewGuid().ToString("N");
                session.desktopHandle = CreateDesktop(session.DesktopName, IntPtr.Zero, IntPtr.Zero, 0, 0xF01FF, IntPtr.Zero);
                if (session.desktopHandle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
                if (InputDesktopName() != session.InputDesktopBefore) throw new InvalidOperationException("输入桌面已变化，未启动测试。");
                session.jobHandle = CreateJobObject(IntPtr.Zero, null);
                if (session.jobHandle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
                var limits = new ExtendedLimits();
                limits.basic.flags = 0x2000; // 关闭任务句柄时，仅结束本次测试进程及其子进程。
                Require(SetInformationJobObject(session.jobHandle, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))));
                var startup = new StartupInfoEx();
                startup.info.cb = (uint)Marshal.SizeOf(typeof(StartupInfoEx));
                startup.info.desktop = ObjectName(GetProcessWindowStation()) + "\\" + session.DesktopName;
                startup.info.flags = 0x101; startup.info.show = 0;
                ProcessInfo process;
                var security = new SecurityAttributes { size = Marshal.SizeOf(typeof(SecurityAttributes)), inherit = true };
                var output = CreateFile(outputFile, 0x40000000, 3, ref security, 2, 0x80, IntPtr.Zero);
                if (output == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
                var input = CreateFile("NUL", 0x80000000, 3, ref security, 3, 0x80, IntPtr.Zero);
                IntPtr handles = IntPtr.Zero;
                bool attributesReady = false;
                try {
                    if (input == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
                    IntPtr size = IntPtr.Zero;
                    InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
                    startup.attributes = Marshal.AllocHGlobal(size);
                    Require(InitializeProcThreadAttributeList(startup.attributes, 1, 0, ref size));
                    attributesReady = true;
                    handles = Marshal.AllocHGlobal(IntPtr.Size * 2);
                    Marshal.Copy(new IntPtr[] { input, output }, 0, handles, 2);
                    Require(UpdateProcThreadAttribute(startup.attributes, 0, new IntPtr(0x20002), handles, new IntPtr(IntPtr.Size * 2), IntPtr.Zero, IntPtr.Zero));
                    startup.info.input = input; startup.info.output = output; startup.info.error = output;
                    Require(CreateProcess(executable, new StringBuilder("\"" + executable + "\" " + arguments), IntPtr.Zero,
                        IntPtr.Zero, true, 0x08080004, IntPtr.Zero, directory, ref startup, out process));
                } finally {
                    if (startup.attributes != IntPtr.Zero) { if (attributesReady) DeleteProcThreadAttributeList(startup.attributes); Marshal.FreeHGlobal(startup.attributes); }
                    if (handles != IntPtr.Zero) Marshal.FreeHGlobal(handles);
                    if (input != new IntPtr(-1)) CloseHandle(input);
                    CloseHandle(output);
                }
                session.processHandle = process.process;
                session.ProcessId = process.processId;
                try {
                    if (!AssignProcessToJobObject(session.jobHandle, process.process)) {
                        int error = Marshal.GetLastWin32Error();
                        TerminateProcess(process.process, 1);
                        throw new Win32Exception(error);
                    }
                    if (ResumeThread(process.thread) == uint.MaxValue) throw new Win32Exception(Marshal.GetLastWin32Error());
                } finally { CloseHandle(process.thread); }
                return session;
            } catch { session.Dispose(); throw; }
        }
        public bool Wait(uint milliseconds) { return WaitForSingleObject(processHandle, milliseconds) == 0; }
        public uint ExitCode {
            get { uint code; Require(GetExitCodeProcess(processHandle, out code)); return code; }
        }
        public void Dispose() {
            if (jobHandle != IntPtr.Zero) { CloseHandle(jobHandle); jobHandle = IntPtr.Zero; }
            if (processHandle != IntPtr.Zero) { CloseHandle(processHandle); processHandle = IntPtr.Zero; }
            if (desktopHandle != IntPtr.Zero) { CloseDesktop(desktopHandle); desktopHandle = IntPtr.Zero; }
        }
    }
}
