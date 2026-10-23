# Unicode-correct .lnk creator (WScript.Shell mutates non-ASCII paths to "?" —
# IShellLinkW is the native, Unicode-safe route).
# Creates an "Amier OS" Desktop shortcut running scripts\amier.bat and
# optionally registers autostart with Windows.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/create-shortcut.ps1 [-Startup] [-Silent]
param(
  [switch]$Startup,
  [switch]$Silent = $false
)

$repo = (Split-Path -Parent $PSScriptRoot)
$bat = Join-Path $repo "scripts\amier.bat"
$ico = Join-Path $repo "apps\desktop\assets\icon.ico"
if (-not (Test-Path $bat)) { throw "launcher missing: $bat" }

if (-not ("Amier.Shortcut.Native" -as [type])) {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

namespace Amier.Shortcut
{
    public static class Native
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct WIN32_FIND_DATAW
        {
            public uint dwFileAttributes;
            public System.Runtime.InteropServices.ComTypes.FILETIME ftCreationTime;
            public System.Runtime.InteropServices.ComTypes.FILETIME ftLastAccessTime;
            public System.Runtime.InteropServices.ComTypes.FILETIME ftLastWriteTime;
            public uint nFileSizeHigh;
            public uint nFileSizeLow;
            public uint dwOriginalAttributes;
            public System.Runtime.InteropServices.ComTypes.FILETIME ftReserved;
            public uint nFileNameLength;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
            public string cFileName;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 14)]
            public string cAlternateFileName;
        }

        [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
        public class ShellLink { }

        [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        public interface IShellLinkW
        {
            void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszFile, int cch, ref WIN32_FIND_DATAW pfd, uint fFlags);
            void GetIDList(out IntPtr ppidl);
            void SetIDList(IntPtr pidl);
            void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszName, int cch);
            void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
            void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszDir, int cch);
            void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
            void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszArgs, int cch);
            void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
            void GetHotkey(out short pwHotkey);
            void SetHotkey(short pwHotkey);
            void GetShowCmd(out int piShowCmd);
            void SetShowCmd(int piShowCmd);
            void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszIconPath, int cch, out int piIcon);
            void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
            void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, uint dwReserved);
            void Resolve(IntPtr hwnd, uint fFlags);
            void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
        }

        public static void Make(string lnk, string target, string args, string workDir, string icon, string desc)
        {
            IShellLinkW link = (IShellLinkW)new ShellLink();
            link.SetPath(target);
            link.SetArguments(args);
            link.SetWorkingDirectory(workDir);
            link.SetDescription(desc);
            if (!string.IsNullOrEmpty(icon)) link.SetIconLocation(icon, 0);
            link.SetShowCmd(7); // SW_SHOWMINNOACTIVE
            ((IPersistFile)link).Save(lnk, true);
        }
    }
}
"@
}

function New-AmierShortcut([string]$linkPath, [string]$desc) {
  [Amier.Shortcut.Native]::Make($linkPath, $bat, "", $repo, $ico, $desc)
}

$desktop = [Environment]::GetFolderPath("Desktop")
New-AmierShortcut (Join-Path $desktop "Amier OS.lnk") "Amier OS personal assistant"
if (-not $Silent) { Write-Host "[amier] Desktop shortcut: $desktop\Amier OS.lnk" }

if ($Startup) {
  $startupDir = [Environment]::GetFolderPath("Startup")
  New-AmierShortcut (Join-Path $startupDir "Amier OS.lnk") "Amier OS assistant (starts with Windows)"
  if (-not $Silent) { Write-Host "[amier] Windows autostart: $startupDir\Amier OS.lnk" }
}
