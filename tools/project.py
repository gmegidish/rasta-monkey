"""Load the whole Unity 2.5 data folder and resolve PPtrs across files."""
from pathlib import Path
import UnityPy
import u25
import mono

DATA = Path(__file__).resolve().parents[1] / 'Payload' / 'RastaMonkey.app' / 'Data'


class Project:
    def __init__(self):
        self.files = {}
        for p in sorted(DATA.iterdir()):
            if p.is_file() and not p.suffix == '.dll' and p.name != 'mono':
                env = UnityPy.load(str(p))
                for f in env.files.values():
                    self.files[p.name] = f
        self.scripts = {}
        for fname, f in self.files.items():
            for o in f.objects.values():
                if o.type.name == 'MonoScript':
                    r = u25.R(o.get_raw_data()); r.str(); r.i32(); cls = r.str()
                    self.scripts[(fname, o.path_id)] = cls

    def resolve(self, fname, pptr):
        fid, pid = pptr
        if pid == 0:
            return None
        if fid == 0:
            return (fname, pid)
        ext = self.files[fname].externals[fid - 1].path
        ext = ext.replace('library/', '')
        return (Path(ext).name, pid)

    def obj(self, key):
        if key is None:
            return None
        f = self.files.get(key[0])
        return f.objects.get(key[1]) if f else None

    def script_name(self, fname, d):
        r = u25.R(d); r.pptr(); r.u8(); r.align(); scr = r.pptr()
        return self.scripts.get(self.resolve(fname, scr))
