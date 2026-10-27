// Вшивает blob Node SEA и иконку в копию node.exe — замена postject/rcedit без скачивания пакетов.
// Использование: SeaInject.exe <exe> <blob> [icon.ico]
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

static class SeaInject
{
    const string Fuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
    static readonly IntPtr RT_ICON = (IntPtr)3, RT_GROUP_ICON = (IntPtr)14, RT_RCDATA = (IntPtr)10;

    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool UpdateResource(IntPtr h, IntPtr type, string name, ushort lang, byte[] data, uint size);
    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "UpdateResourceW")] static extern bool UpdateResourceId(IntPtr h, IntPtr type, IntPtr name, ushort lang, byte[] data, uint size);
    [DllImport("kernel32", SetLastError = true)] static extern bool EndUpdateResource(IntPtr h, bool discard);
    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
    [DllImport("kernel32")] static extern bool FreeLibrary(IntPtr h);
    delegate bool EnumNameProc(IntPtr module, IntPtr type, IntPtr name, IntPtr param);
    delegate bool EnumLangProc(IntPtr module, IntPtr type, IntPtr name, ushort lang, IntPtr param);
    [DllImport("kernel32", CharSet = CharSet.Unicode)] static extern bool EnumResourceNames(IntPtr module, IntPtr type, EnumNameProc cb, IntPtr param);
    [DllImport("kernel32", CharSet = CharSet.Unicode)] static extern bool EnumResourceLanguages(IntPtr module, IntPtr type, IntPtr name, EnumLangProc cb, IntPtr param);

    static int Main(string[] args)
    {
        bool gui = Array.IndexOf(args, "--gui") >= 0;
        args = Array.FindAll(args, a => a != "--gui");
        if (args.Length < 2) { Console.Error.WriteLine("SeaInject <exe> <blob> [icon.ico] [--gui]"); return 2; }
        string exe = args[0];

        // 1. включаем «предохранитель»: node проверяет строку FUSE:1, чтобы искать вшитое приложение
        byte[] bin = File.ReadAllBytes(exe);
        byte[] needle = Encoding.ASCII.GetBytes(Fuse + ":0");
        int at = IndexOf(bin, needle);
        if (at < 0) { Console.Error.WriteLine("В node.exe нет SEA-предохранителя (нужен Node 20+), или blob уже вшит"); return 1; }
        bin[at + needle.Length - 1] = (byte)'1';
        // --gui: подсистема Windows GUI вместо консоли — без чёрного окна при запуске
        if (gui)
        {
            int pe = BitConverter.ToInt32(bin, 0x3C);
            int subsystem = pe + 4 + 20 + 68;   // одинаково для PE32 и PE32+
            bin[subsystem] = 2; bin[subsystem + 1] = 0;
        }
        File.WriteAllBytes(exe, bin);

        // 2. какие иконки есть у node.exe — заменим их своими
        var groups = new List<KeyValuePair<IntPtr, ushort>>();
        var icons = new List<KeyValuePair<IntPtr, ushort>>();
        if (args.Length > 2)
        {
            IntPtr mod = LoadLibraryEx(exe, IntPtr.Zero, 0x2 /* LOAD_LIBRARY_AS_DATAFILE */);
            if (mod != IntPtr.Zero)
            {
                Collect(mod, RT_GROUP_ICON, groups);
                Collect(mod, RT_ICON, icons);
                FreeLibrary(mod);
            }
        }

        IntPtr h = BeginUpdateResource(exe, false);
        if (h == IntPtr.Zero) return Fail("BeginUpdateResource");
        byte[] blob = File.ReadAllBytes(args[1]);
        if (!UpdateResource(h, RT_RCDATA, "NODE_SEA_BLOB", 0, blob, (uint)blob.Length)) return Fail("UpdateResource(blob)");

        if (args.Length > 2)
        {
            foreach (var i in icons) UpdateResourceId(h, RT_ICON, i.Key, i.Value, null, 0);   // удалить старые картинки
            ushort lang = groups.Count > 0 ? groups[0].Value : (ushort)1033;
            IntPtr groupId = groups.Count > 0 ? groups[0].Key : (IntPtr)1;
            foreach (var g in groups) if (g.Key != groupId || g.Value != lang) UpdateResourceId(h, RT_GROUP_ICON, g.Key, g.Value, null, 0);
            if (!WriteIcon(h, args[2], groupId, lang)) return Fail("UpdateResource(icon)");
        }
        if (!EndUpdateResource(h, false)) return Fail("EndUpdateResource");
        Console.WriteLine("OK");
        return 0;
    }

    static void Collect(IntPtr mod, IntPtr type, List<KeyValuePair<IntPtr, ushort>> into)
    {
        var names = new List<IntPtr>();
        EnumResourceNames(mod, type, (m, t, n, p) => { if (((long)n >> 16) == 0) names.Add(n); return true; }, IntPtr.Zero);
        foreach (var n in names)
            EnumResourceLanguages(mod, type, n, (m, t, nm, l, p) => { into.Add(new KeyValuePair<IntPtr, ushort>(nm, l)); return true; }, IntPtr.Zero);
    }

    // .ico → RT_ICON (картинки) + RT_GROUP_ICON (каталог), id картинок с 1
    static bool WriteIcon(IntPtr h, string icoPath, IntPtr groupId, ushort lang)
    {
        byte[] ico = File.ReadAllBytes(icoPath);
        int count = BitConverter.ToUInt16(ico, 4);
        var dir = new MemoryStream();
        var w = new BinaryWriter(dir);
        w.Write((ushort)0); w.Write((ushort)1); w.Write((ushort)count);
        for (int i = 0; i < count; i++)
        {
            int e = 6 + 16 * i;
            int size = BitConverter.ToInt32(ico, e + 8), offset = BitConverter.ToInt32(ico, e + 12);
            byte[] img = new byte[size];
            Buffer.BlockCopy(ico, offset, img, 0, size);
            if (!UpdateResourceId(h, RT_ICON, (IntPtr)(i + 1), lang, img, (uint)size)) return false;
            w.Write(ico, e, 12);              // ширина, высота, цвета, резерв, планы, биты, размер
            w.Write((ushort)(i + 1));         // id картинки вместо смещения
        }
        w.Flush();
        byte[] grp = dir.ToArray();
        return UpdateResourceId(h, RT_GROUP_ICON, groupId, lang, grp, (uint)grp.Length);
    }

    static int IndexOf(byte[] hay, byte[] needle)
    {
        for (int i = 0; i <= hay.Length - needle.Length; i++)
        {
            int j = 0;
            while (j < needle.Length && hay[i + j] == needle[j]) j++;
            if (j == needle.Length) return i;
        }
        return -1;
    }

    static int Fail(string what)
    {
        Console.Error.WriteLine(what + " не удалось, код " + Marshal.GetLastWin32Error());
        return 1;
    }
}
