/**
 * Impresión térmica optimizada para rollo MHT-80 de 72 mm.
 * El contenido se genera en una ventana independiente para que Chrome no
 * intente imprimir el layout completo de la aplicación.
 */
function abrirImpresionTermica(contenido: string, titulo: string) {
  const w = window.open("", "_blank", "width=360,height=720");
  if (!w) {
    alert("El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para este sitio.");
    return;
  }

  w.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title>
<style>
  /* MHT-80 del usuario: papel configurado a 72 mm. Sin márgenes del navegador. */
  @page { size: 72mm auto; margin: 0; }
  * { box-sizing: border-box !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body {
    width: 72mm !important;
    max-width: 72mm !important;
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    color: #000 !important;
    overflow: hidden !important;
  }
  body {
    font-family: Arial, Helvetica, sans-serif !important;
    font-size: 12.5px !important;
    line-height: 1.28 !important;
    font-weight: 600 !important;
  }
  .ticket-print {
    width: 68mm !important;
    max-width: 68mm !important;
    margin: 0 2mm !important;
    padding: 2mm 0 3mm !important;
    background: #fff !important;
    color: #000 !important;
  }
  .ticket-print, .ticket-print * {
    color: #000 !important;
    background-color: transparent !important;
    text-shadow: none !important;
    box-shadow: none !important;
    opacity: 1 !important;
    border-color: #000 !important;
    font-family: Arial, Helvetica, sans-serif !important;
  }
  .ticket-print p { margin: 2px 0 !important; padding: 0 !important; }
  .ticket-print .text-center { text-align: center !important; }
  .ticket-print .font-bold, .ticket-print b, .ticket-print strong { font-weight: 900 !important; }
  .ticket-print .flex { display: flex !important; width: 100% !important; gap: 2mm !important; }
  .ticket-print .justify-between { justify-content: space-between !important; }
  .ticket-print .justify-between > :first-child {
    flex: 1 1 auto !important; min-width: 0 !important; overflow-wrap: anywhere !important;
  }
  .ticket-print .justify-between > :last-child { flex: 0 0 auto !important; white-space: nowrap !important; }
  .ticket-print .my-1 { margin: 4px 0 !important; }
  .ticket-print div[style*="border-top"] { border-top: 1.5px dashed #000 !important; }
  button, .no-print { display: none !important; }
  @media print {
    html, body { width: 72mm !important; max-width: 72mm !important; }
    .ticket-print { width: 68mm !important; max-width: 68mm !important; margin: 0 2mm !important; }
  }
</style>
</head>
<body>
  <div class="ticket-print">${contenido}</div>
<script>
  window.onload = () => {
    setTimeout(() => {
      window.focus();
      window.print();
    }, 300);
  };
  window.onafterprint = () => window.close();
<\/script>
</body>
</html>`);
  w.document.close();
}

export function imprimirTicket(elementId = "recibo-termico") {
  const el = document.getElementById(elementId);
  if (!el) {
    alert("No se encontró el ticket para imprimir.");
    return;
  }
  abrirImpresionTermica(el.innerHTML, "Ticket Loves Stories");
}

export function imprimirPruebaTermica() {
  abrirImpresionTermica(`
    <div style="text-align:center;font-weight:900;font-size:18px;letter-spacing:.3px">LOVE'S STORIES</div>
    <div style="border-top:2px dashed #000;margin:6px 0"></div>
    <div style="text-align:center;font-weight:900;font-size:14px">PRUEBA DE IMPRESIÓN</div>
    <p style="text-align:center;font-weight:700">Texto negro y nítido · Papel 72 mm</p>
    <div style="border-top:2px dashed #000;margin:6px 0"></div>
    <div style="display:flex;justify-content:space-between;font-weight:700"><span>Producto prueba x1</span><span>Bs 100.00</span></div>
    <div style="display:flex;justify-content:space-between;font-weight:900;font-size:15px;margin-top:5px"><span>TOTAL</span><span>Bs 100.00</span></div>
  `, "Prueba térmica Loves Stories");
}
