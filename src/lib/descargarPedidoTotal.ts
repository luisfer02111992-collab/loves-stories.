const RUTA = "/pedido-total-pdf/";
const CACHE = "loves-stories-pedido-total-adjunto-v2";
const VIGENCIA = 5 * 60_000;

let registro: Promise<ServiceWorkerRegistration> | undefined;

export function activarDescargasPedidoTotal() {
  if (!registro) {
    registro = (async () => {
      const registro = await navigator.serviceWorker.register(`${RUTA}adjunto-sw.js`, { scope: RUTA });
      const worker = registro.active ?? registro.waiting ?? registro.installing;
      if (!worker) throw new Error("No se pudo activar la descarga.");

      if (worker.state !== "activated") {
        await new Promise<void>((resolve, reject) => {
          const comprobar = () => {
            if (worker.state === "activated") terminar(resolve);
            if (worker.state === "redundant") terminar(() => reject(new Error("Descarga no disponible.")));
          };
          const limite = window.setTimeout(() => terminar(() => reject(new Error("La descarga tardó en activarse."))), 8000);
          function terminar(finalizar: () => void) {
            window.clearTimeout(limite);
            worker.removeEventListener("statechange", comprobar);
            finalizar();
          }
          worker.addEventListener("statechange", comprobar);
          comprobar();
        });
      }
      return registro;
    })().catch((error) => {
      registro = undefined;
      throw error;
    });
  }
  return registro;
}

export async function prepararDescargaPedidoTotal(pdf: Blob, nombre: string) {
  const cache = await caches.open(CACHE);
  const ahora = Date.now();
  const ruta = `${RUTA}${ahora}-${crypto.randomUUID()}.pdf`;
  const caducados = (await cache.keys()).filter((solicitud) => {
    const creado = Number(new URL(solicitud.url).pathname.slice(RUTA.length, RUTA.length + 13));
    return ahora - creado > VIGENCIA;
  });
  await Promise.all(caducados.map((solicitud) => cache.delete(solicitud)));

  const nombreCodificado = encodeURIComponent(nombre).replace(/['()*]/g, (caracter) =>
    `%${caracter.charCodeAt(0).toString(16).toUpperCase()}`
  );
  await cache.put(ruta, new Response(pdf, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="pedido_total.pdf"; filename*=UTF-8''${nombreCodificado}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Length": String(pdf.size),
      "Cache-Control": "no-store",
    },
  }));
  return { ruta, vence: ahora + VIGENCIA, borrar: () => cache.delete(ruta) };
}
