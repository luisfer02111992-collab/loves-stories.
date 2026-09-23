/**
 * Ticket térmico para impresoras POS de rollo de 80 mm.
 * El ancho es fijo (80 mm); el largo lo controla el rollo/driver según el contenido.
 * IMPORTANTE: la app nunca llama a print() hasta que el usuario pulse "Imprimir ahora".
 */
function abrirImpresionTermica(contenido: string, titulo: string) {
  const w = window.open("", "_blank", "width=460,height=780");
  if (!w) {
    alert("El navegador bloqueó la vista previa. Permite ventanas emergentes para este sitio.");
    return;
  }

  w.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title>
<style>
*{box-sizing:border-box!important} html,body{margin:0!important;padding:0!important;background:#ececec!important;color:#000!important}
body{font-family:Arial,Helvetica,sans-serif!important}
.preview-bar{position:sticky;top:0;z-index:20;display:flex;gap:10px;align-items:center;justify-content:center;padding:12px;background:#fff;border-bottom:1px solid #bbb}
.preview-bar button{border:0;border-radius:7px;padding:10px 18px;font-weight:900;cursor:pointer}.btn-print{background:#111;color:#fff}.btn-cancel{background:#ddd;color:#111}
.help{font-size:12px;line-height:1.4;text-align:center;background:#fff;padding:0 14px 10px;color:#222}.paper{width:80mm;margin:14px auto;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.18)}
.ticket-print{width:76mm!important;max-width:76mm!important;margin:0 2mm!important;padding:3mm 0 4mm!important;background:#fff!important;color:#000!important;font-family:Arial,Helvetica,sans-serif!important;font-size:13px!important;line-height:1.28!important;font-weight:700!important;overflow:visible!important}
.ticket-print,.ticket-print *{color:#000!important;text-shadow:none!important;box-shadow:none!important;opacity:1!important;border-color:#000!important;font-family:Arial,Helvetica,sans-serif!important}
.ticket-print img{display:none!important}.ticket-print p{margin:2px 0!important;padding:0!important}.ticket-print .text-center{text-align:center!important}.ticket-print .font-bold,.ticket-print b,.ticket-print strong{font-weight:900!important}.ticket-print .flex{display:flex!important;width:100%!important;gap:2mm!important}.ticket-print .justify-between{justify-content:space-between!important}.ticket-print .justify-between>:first-child{flex:1 1 auto!important;min-width:0!important;overflow-wrap:anywhere!important}.ticket-print .justify-between>:last-child{flex:0 0 auto!important;white-space:nowrap!important}.ticket-print .my-1{margin:5px 0!important}.ticket-print div[style*="border-top"]{border-top:1.5px dashed #000!important}
@media print{
  @page{size:80mm auto;margin:0}
  html,body{width:80mm!important;min-width:80mm!important;margin:0!important;padding:0!important;background:#fff!important;height:auto!important;min-height:0!important}
  .preview-bar,.help,.no-print{display:none!important}.paper{width:80mm!important;margin:0!important;padding:0!important;box-shadow:none!important;background:#fff!important;height:auto!important;min-height:0!important}
  .ticket-print{width:76mm!important;max-width:76mm!important;margin:0 2mm!important;padding:3mm 0 4mm!important;height:auto!important;min-height:0!important}
}
</style></head><body>
<div class="preview-bar no-print"><button class="btn-cancel" id="cancelar">Cancelar</button><button class="btn-print" id="imprimir">Imprimir ahora</button></div>
<div class="help no-print"><b>Ticket térmico 80 mm · sin imágenes.</b><br>Cancelar aquí cierra la vista previa sin enviar ningún trabajo. Una vez confirmado en la ventana de Windows/Chrome, la web ya no puede detener un trabajo que la impresora haya recibido.</div>
<div class="paper"><div class="ticket-print">${contenido}</div></div>
<script>(function(){
 let enviado=false;
 const cancelar=document.getElementById('cancelar'); const imprimir=document.getElementById('imprimir');
 cancelar.addEventListener('click',function(){ if(!enviado) window.close(); else alert('El trabajo ya fue enviado al cuadro de impresión. Cancélalo también allí o en la cola de Windows si ya fue confirmado.'); });
 imprimir.addEventListener('click',function(){ if(enviado)return; enviado=true; imprimir.disabled=true; imprimir.textContent='Abriendo impresión…'; window.focus(); setTimeout(function(){window.print();},120); });
 window.addEventListener('afterprint',function(){ enviado=false; imprimir.disabled=false; imprimir.textContent='Imprimir ahora'; });
})();<\/script></body></html>`);
  w.document.close();
}

export function imprimirTicket(elementId = "recibo-termico") {
  const el = document.getElementById(elementId);
  if (!el) { alert("No se encontró el ticket para imprimir."); return; }
  abrirImpresionTermica(el.innerHTML, "Ticket térmico 80 mm - Loves Stories");
}

export function imprimirPruebaTermica() {
  abrirImpresionTermica(`
    <div style="text-align:center;font-weight:900;font-size:18px">LOVE'S STORIES</div>
    <div style="border-top:2px dashed #000;margin:6px 0"></div>
    <div style="text-align:center;font-weight:900;font-size:14px">PRUEBA TÉRMICA 80 mm</div>
    <p style="text-align:center;font-weight:800">Sin imágenes · negro sólido</p>
    <div style="border-top:2px dashed #000;margin:6px 0"></div>
    <div style="display:flex;justify-content:space-between;font-weight:800"><span>Producto prueba x1</span><span>Bs 100.00</span></div>
    <div style="display:flex;justify-content:space-between;font-weight:900;font-size:15px;margin-top:5px"><span>TOTAL</span><span>Bs 100.00</span></div>
  `,"Prueba térmica 80 mm - Loves Stories");
}
