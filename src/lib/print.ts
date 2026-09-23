/**
 * Impresión térmica MHT-80 / rollo de 72 mm.
 *
 * IMPORTANTE:
 * - Nunca imprime automáticamente: primero muestra una vista previa con Imprimir/Cancelar.
 * - Justo antes de imprimir calcula el alto REAL del ticket y crea una página de ese tamaño.
 *   Esto evita que un driver de rollo (p. ej. 72 x 3276 mm) avance metros de papel en blanco.
 */
function abrirImpresionTermica(contenido: string, titulo: string) {
  const w = window.open("", "_blank", "width=430,height=760");
  if (!w) {
    alert("El navegador bloqueó la vista previa. Permite ventanas emergentes para este sitio.");
    return;
  }

  w.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title>
<style id="page-size-style">@page { margin: 0; }</style>
<style>
  * { box-sizing: border-box !important; }
  html, body { margin:0 !important; padding:0 !important; background:#ececec !important; color:#000 !important; }
  body { font-family: Arial, Helvetica, sans-serif !important; }
  .preview-bar {
    position: sticky; top: 0; z-index: 20; display:flex; gap:10px; align-items:center;
    justify-content:center; padding:12px; background:#fff; border-bottom:1px solid #ccc;
  }
  .preview-bar button { border:0; border-radius:7px; padding:10px 18px; font-weight:800; cursor:pointer; }
  .btn-print { background:#111; color:#fff; }
  .btn-cancel { background:#e5e5e5; color:#111; }
  .preview-help { font-size:12px; color:#333; text-align:center; background:#fff; padding:0 10px 10px; }
  .paper { width:72mm; margin:14px auto; padding:0; background:#fff; box-shadow:0 2px 12px rgba(0,0,0,.18); }
  .ticket-print {
    width:68mm !important; max-width:68mm !important; margin:0 2mm !important;
    padding:2mm 0 3mm !important; background:#fff !important; color:#000 !important;
    font-family: Arial, Helvetica, sans-serif !important; font-size:12.5px !important;
    line-height:1.25 !important; font-weight:700 !important; overflow:visible !important;
  }
  .ticket-print, .ticket-print * {
    color:#000 !important; text-shadow:none !important; box-shadow:none !important;
    opacity:1 !important; border-color:#000 !important; font-family:Arial,Helvetica,sans-serif !important;
  }
  .ticket-print p { margin:2px 0 !important; padding:0 !important; }
  .ticket-print .text-center { text-align:center !important; }
  .ticket-print .font-bold, .ticket-print b, .ticket-print strong { font-weight:900 !important; }
  .ticket-print .flex { display:flex !important; width:100% !important; gap:2mm !important; }
  .ticket-print .justify-between { justify-content:space-between !important; }
  .ticket-print .justify-between > :first-child { flex:1 1 auto !important; min-width:0 !important; overflow-wrap:anywhere !important; }
  .ticket-print .justify-between > :last-child { flex:0 0 auto !important; white-space:nowrap !important; }
  .ticket-print .my-1 { margin:4px 0 !important; }
  .ticket-print div[style*="border-top"] { border-top:1.5px dashed #000 !important; }

  @media print {
    html, body { width:72mm !important; margin:0 !important; padding:0 !important; background:#fff !important; }
    .preview-bar, .preview-help { display:none !important; }
    .paper { width:72mm !important; margin:0 !important; padding:0 !important; box-shadow:none !important; background:#fff !important; }
    .ticket-print { width:68mm !important; max-width:68mm !important; margin:0 2mm !important; padding:2mm 0 3mm !important; }
    button, .no-print { display:none !important; }
  }
</style>
</head>
<body>
  <div class="preview-bar no-print">
    <button class="btn-cancel" id="cancelar">Cancelar</button>
    <button class="btn-print" id="imprimir">Imprimir</button>
  </div>
  <div class="preview-help no-print">Vista previa del ticket · No se enviará nada a la impresora hasta pulsar <b>Imprimir</b>.</div>
  <div class="paper" id="paper"><div class="ticket-print" id="ticket">${contenido}</div></div>
<script>
(function(){
  const cancelar = document.getElementById('cancelar');
  const imprimir = document.getElementById('imprimir');
  const ticket = document.getElementById('ticket');
  const pageStyle = document.getElementById('page-size-style');

  cancelar.addEventListener('click', function(){ window.close(); });

  imprimir.addEventListener('click', function(){
    // 96 CSS px = 25.4 mm. Sumamos 4 mm de seguridad para el corte.
    const px = Math.max(ticket.scrollHeight, ticket.getBoundingClientRect().height);
    const altoMm = Math.max(30, Math.ceil((px * 25.4 / 96) + 4));
    // Nunca permitir una página kilométrica por un error de layout.
    const altoSeguro = Math.min(altoMm, 500);
    pageStyle.textContent = '@page { size: 72mm ' + altoSeguro + 'mm; margin: 0; }';
    document.body.style.height = altoSeguro + 'mm';
    document.documentElement.style.height = altoSeguro + 'mm';
    window.focus();
    setTimeout(function(){ window.print(); }, 80);
  });
})();
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
    <p style="text-align:center;font-weight:800">Texto negro y nítido · Papel 72 mm</p>
    <div style="border-top:2px dashed #000;margin:6px 0"></div>
    <div style="display:flex;justify-content:space-between;font-weight:800"><span>Producto prueba x1</span><span>Bs 100.00</span></div>
    <div style="display:flex;justify-content:space-between;font-weight:900;font-size:15px;margin-top:5px"><span>TOTAL</span><span>Bs 100.00</span></div>
  `, "Prueba térmica Loves Stories");
}
