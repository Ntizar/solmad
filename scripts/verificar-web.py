#!/usr/bin/env python3
"""Verificacion de SolMAD en un navegador real (headless) por Chrome DevTools Protocol.

Comprueba lo que un test unitario no ve: que el navegador carga los datos, que el
mapa se pinta de verdad y que no hay errores de JavaScript. Vale para local y para
produccion.

Sin dependencias: el cliente WebSocket esta implementado sobre la libreria
estandar (solo necesita Python 3 y Chrome/Edge instalados).

Uso:
  python scripts/verificar-web.py https://solmad.vercel.app
  python scripts/verificar-web.py http://127.0.0.1:4188/ salida.png --zoom 6

Codigos de salida: 0 = todo bien, 2 = hay errores de JavaScript, 1 = no se pudo arrancar.
"""
import argparse
import base64
import json
import os
import socket
import struct
import subprocess
import sys
import time
import urllib.parse
import urllib.request

CHROME_CANDIDATOS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


def encontrar_chrome():
    for c in CHROME_CANDIDATOS:
        if os.path.exists(c):
            return c
    return None


class WebSocketMin:
    """Cliente WebSocket minimo (RFC 6455) solo texto, sobre la stdlib."""

    def __init__(self, url, timeout=90):
        u = urllib.parse.urlparse(url)
        host = u.hostname
        port = u.port or (443 if u.scheme == "wss" else 80)
        ruta = u.path or "/"
        if u.query:
            ruta += "?" + u.query
        if u.scheme == "wss":
            import ssl
            self.sock = ssl.create_default_context().wrap_socket(
                socket.create_connection((host, port), timeout=timeout), server_hostname=host
            )
        else:
            self.sock = socket.create_connection((host, port), timeout=timeout)
        self.sock.settimeout(timeout)
        clave = base64.b64encode(os.urandom(16)).decode()
        peticion = (
            f"GET {ruta} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {clave}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            # Sin cabecera Origin: Chrome rechaza el handshake si el Origin no
            # esta en --remote-allow-origins.
            "\r\n"
        )
        self.sock.sendall(peticion.encode())
        # El ERROR de Chrome al rechazar trae ~239 bytes de HTML con un 403
        respuesta = b""
        while b"\r\n\r\n" not in respuesta:
            trozo = self.sock.recv(4096)
            if not trozo:
                raise RuntimeError("handshake cerrado por el servidor: " + respuesta.decode(errors="replace")[:160])
            respuesta += trozo
        cabecera = respuesta.split(b"\r\n\r\n")[0].decode(errors="replace")
        if "101" not in cabecera.split("\r\n")[0]:
            raise RuntimeError("handshake fallido: " + cabecera.split("\r\n")[0][:160])
        self.resto = respuesta.split(b"\r\n\r\n", 1)[1]

    def _leer(self, n):
        datos = self.resto[:n]
        self.resto = self.resto[len(datos):]
        while len(datos) < n:
            trozo = self.sock.recv(n - len(datos))
            if not trozo:
                raise RuntimeError("conexion cerrada")
            datos += trozo
        return datos

    def enviar(self, texto):
        carga = texto.encode()
        mascara = os.urandom(4)
        cabecera = bytearray([0x81])  # FIN + opcode texto
        n = len(carga)
        if n < 126:
            cabecera.append(0x80 | n)
        elif n < 65536:
            cabecera.append(0x80 | 126)
            cabecera += struct.pack(">H", n)
        else:
            cabecera.append(0x80 | 127)
            cabecera += struct.pack(">Q", n)
        cabecera += mascara
        enmascarado = bytes(b ^ mascara[i % 4] for i, b in enumerate(carga))
        self.sock.sendall(bytes(cabecera) + enmascarado)

    def recibir(self):
        """Devuelve un mensaje de texto completo (uniendo fragmentos)."""
        partes = []
        while True:
            b1, b2 = self._leer(2)
            fin = b1 & 0x80
            opcode = b1 & 0x0F
            largo = b2 & 0x7F
            if largo == 126:
                largo = struct.unpack(">H", self._leer(2))[0]
            elif largo == 127:
                largo = struct.unpack(">Q", self._leer(8))[0]
            mascara = self._leer(4) if (b2 & 0x80) else None
            carga = self._leer(largo)
            if mascara:
                carga = bytes(b ^ mascara[i % 4] for i, b in enumerate(carga))
            if opcode == 0x8:  # close
                raise RuntimeError("el navegador cerro la conexion")
            if opcode == 0x9:  # ping -> pong
                self.enviar(carga.decode(errors="replace"))
                continue
            if opcode in (0x1, 0x0):
                partes.append(carga)
            if fin:
                return b"".join(partes).decode(errors="replace")


class CDP:
    """Cliente minimo de Chrome DevTools Protocol."""

    def __init__(self, url):
        self.ws = WebSocketMin(url)
        self.i = 0
        self.eventos = []

    def send(self, method, params=None):
        self.i += 1
        self.ws.enviar(json.dumps({"id": self.i, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recibir())
            if msg.get("id") == self.i:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})
            self.eventos.append(msg)

    def eval(self, expr):
        r = self.send("Runtime.evaluate", {"expression": expr, "returnByValue": True})
        if "exceptionDetails" in r:
            return {"__error": str(r["exceptionDetails"])[:300]}
        return r.get("result", {}).get("value")

    def excepciones(self):
        return [
            {
                "texto": e["params"]["exceptionDetails"].get("text"),
                "detalle": (e["params"]["exceptionDetails"].get("exception") or {}).get("description", "")[:300],
            }
            for e in self.eventos
            if e.get("method") == "Runtime.exceptionThrown"
        ]


def main():
    ap = argparse.ArgumentParser(description="Verifica SolMAD en un navegador headless")
    ap.add_argument("url", nargs="?", default="http://127.0.0.1:4188/")
    ap.add_argument("captura", nargs="?", default=None, help="PNG de salida (opcional)")
    ap.add_argument("--zoom", type=int, default=0, help="clics de zoom antes de medir (huellas: >=6)")
    ap.add_argument("--espera", type=float, default=10.0, help="segundos de espera tras saltar la intro")
    args = ap.parse_args()

    chrome = encontrar_chrome()
    if not chrome:
        print("No encuentro Chrome/Edge. Instalalo o edita CHROME_CANDIDATOS.")
        return 1

    # Puerto y perfil unicos: evita engancharse a un Chrome zombi de otra ejecucion
    # (en Windows los hijos sobreviven y el puerto se reutiliza).
    puerto = 9300 + (os.getpid() % 400)
    perfil = os.path.join(os.environ.get("TEMP", "/tmp"), f"solmad-verifica-{os.getpid()}")
    proc = subprocess.Popen(
        [
            chrome, "--headless=new", f"--remote-debugging-port={puerto}",
            f"--user-data-dir={perfil}", "--no-first-run", "--no-default-browser-check",
            "--remote-allow-origins=*", "--disable-extensions",
            "--disable-background-networking", "--window-size=1280,900",
            "--hide-scrollbars", "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        ws_url = None
        for _ in range(40):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{puerto}/json/list", timeout=2) as fh:
                    objetivos = json.load(fh)
                paginas = [t for t in objetivos if t.get("type") == "page"]
                if paginas:
                    ws_url = paginas[0]["webSocketDebuggerUrl"]
                    break
            except Exception:
                pass
            time.sleep(0.5)
        if not ws_url:
            print("FALLO: Chrome no expuso el endpoint CDP")
            return 1

        c = CDP(ws_url)
        c.send("Page.enable")
        c.send("Runtime.enable")
        c.send("Page.navigate", {"url": args.url})
        time.sleep(7)

        print("intro:", c.eval("(()=>{const b=[...document.querySelectorAll('button,a')].find(x=>/Saltar/i.test(x.textContent||''));if(b){b.click();return b.textContent.trim();}return 'no encontrada';})()"))
        time.sleep(args.espera)

        print("URL:", args.url)
        print("DATOS:", c.eval("""(()=>{const r=performance.getEntriesByType('resource');
          const bl=r.filter(x=>/buildings\\//.test(x.name));
          const mx=r.filter(x=>/solar-matrix\\.bin/.test(x.name));
          return JSON.stringify({
            overpass: r.filter(x=>/overpass/.test(x.name)).length,
            tilesEdificios: bl.length,
            kbEdificios: Math.round(bl.reduce((a,x)=>a+(x.transferSize||0),0)/1024),
            matriz: mx.map(x=>Math.round(x.transferSize||0)+'B/'+Math.round(x.duration)+'ms'),
            bundle: r.filter(x=>/index-.*\\.js/.test(x.name)).map(x=>x.name.split('/').pop())
          });})()"""))
        print("CONTADOR:", c.eval("""(()=>{const m=document.body.innerText.match(/[0-9.]+ de [0-9.]+ terrazas al sol|Sin sol en Madrid/);return m?m[0]:'NO';})()"""))
        print("CREDITOS:", c.eval("""(()=>{const m=document.body.innerText.match(/Hecho con[^\\n]{0,70}/);return m?m[0].trim():'NO';})()"""))

        if args.zoom > 0:
            for _ in range(args.zoom):
                c.eval("(()=>{const b=document.querySelector('.leaflet-control-zoom-in');if(b)b.click();})()")
                time.sleep(0.7)
            time.sleep(3)

        # Las huellas de terraza se dibujan en CANVAS (preferCanvas: true), asi que
        # contar <path> en SVG no sirve: se cuentan pixeles por color.
        print("PINTADO:", c.eval("""(()=>{const obj={sol:[245,185,66],sombra:[107,122,143]};
          let sol=0,sombra=0,otros=0;
          document.querySelectorAll('canvas').forEach(c=>{
            let ctx=null; try{ctx=c.getContext('2d');}catch(e){}
            if(!ctx)return; let d; try{d=ctx.getImageData(0,0,c.width,c.height).data;}catch(e){return;}
            for(let i=0;i<d.length;i+=4){ if(!d[i+3])continue;
              const a=Math.abs(d[i]-obj.sol[0])+Math.abs(d[i+1]-obj.sol[1])+Math.abs(d[i+2]-obj.sol[2]);
              const b=Math.abs(d[i]-obj.sombra[0])+Math.abs(d[i+1]-obj.sombra[1])+Math.abs(d[i+2]-obj.sombra[2]);
              if(a<=70)sol++; else if(b<=70)sombra++; else otros++; }});
          return JSON.stringify({sol,sombra,otros});})()"""))

        errs = c.excepciones()
        print("EXCEPCIONES JS:", len(errs))
        for e in errs[:5]:
            print("   -", e["texto"], "|", e["detalle"][:220])

        if args.captura:
            shot = c.send("Page.captureScreenshot", {"format": "png"})
            with open(args.captura, "wb") as fh:
                fh.write(base64.b64decode(shot["data"]))
            print("CAPTURA:", args.captura, os.path.getsize(args.captura), "bytes")

        return 0 if not errs else 2
    finally:
        try:
            proc.terminate()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
