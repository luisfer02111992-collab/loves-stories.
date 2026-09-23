export function imprimirTicket(elementId = "recibo-termico") {
  const el = document.getElementById(elementId);
  if (!el) { alert("No se encontró el ticket para imprimir."); return; }
  const w = window.open("", "_blank", "width=420,height=720");
  if (!w) { alert("El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para este sitio."); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Ticket</title><style>
    @page{size:72mm auto;margin:2mm}html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif}
    .ticket{box-sizing:border-box;width:68mm;padding:1mm;font-size:11px;line-height:1.35}.text-center{text-align:center}.font-bold{font-weight:700}
    .flex{display:flex}.justify-between{justify-content:space-between}.my-1{margin:3px 0}p{margin:2px 0}button{display:none!important}
    @media print{html,body{width:72mm}.ticket{width:68mm}}
  </style></head><body><div class="ticket">${el.innerHTML}</div><script>window.onload=()=>{setTimeout(()=>{window.print();window.onafterprint=()=>window.close()},150)}<\/script></body></html>`);
  w.document.close();
}

export function imprimirPruebaTermica() {
  const w = window.open("", "_blank", "width=420,height=600");
  if (!w) { alert("Permite ventanas emergentes para realizar la prueba de impresión."); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Prueba térmica</title><style>@page{size:72mm auto;margin:2mm}body{width:68mm;margin:0;padding:2mm;font:12px Arial;color:#000;background:#fff;text-align:center}hr{border:0;border-top:1px dashed #000}</style></head><body><b>LOVE'S STORIES</b><hr>PRUEBA DE IMPRESIÓN<br>Si puedes leer esto, la impresora está lista.<hr><script>window.onload=()=>setTimeout(()=>window.print(),150)<\/script></body></html>`);
  w.document.close();
}
