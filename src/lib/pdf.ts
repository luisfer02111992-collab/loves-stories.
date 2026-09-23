import { jsPDF } from "jspdf";
import type { GrupoProducto } from "./pricing";

interface DatosPdfPedido {
  negocio: string;
  cliente: string;
  telefono: string;
  fecha: string;
  grupos: GrupoProducto[];
  subtotalSinDescuento: number;
  descuentoTotal: number;
  total: number;
  depositado: number;
  saldo: number;
  cerrado: boolean;
  pagoFinal?: number;
}

interface DatosPdfDevolucion {
  negocio: string;
  cliente: string;
  numeroVenta: number;
  fecha: string;
  producto: string;
  cantidad: number;
  motivo: string;
  monto: number;
  formaDevolucion: string;
  observacion?: string;
}

// Comprobante de una devolución. Deja constancia por separado de la venta original.
export function generarPdfDevolucion(datos: DatosPdfDevolucion): Blob {
  const doc = new jsPDF({ unit: "mm", format: [80, 150] });
  let y = 10;
  const x1 = 5;
  const ancho = 70;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(datos.negocio, x1 + ancho / 2, y, { align: "center" });
  y += 6;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Comprobante de devolución", x1 + ancho / 2, y, { align: "center" });
  y += 7;

  doc.text(`Cliente: ${datos.cliente}`, x1, y); y += 4;
  doc.text(`Venta N.º: ${datos.numeroVenta}`, x1, y); y += 4;
  doc.text(`Fecha: ${datos.fecha}`, x1, y); y += 5;
  doc.line(x1, y, x1 + ancho, y); y += 5;

  doc.text(`Producto: ${datos.producto}`, x1, y, { maxWidth: ancho }); y += 5;
  doc.text(`Cantidad: ${datos.cantidad}`, x1, y); y += 4;
  doc.text(`Motivo: ${datos.motivo}`, x1, y, { maxWidth: ancho }); y += 5;
  doc.text(`Forma de devolución: ${datos.formaDevolucion}`, x1, y, { maxWidth: ancho }); y += 5;
  if (datos.observacion) {
    doc.text(`Observación: ${datos.observacion}`, x1, y, { maxWidth: ancho }); y += 5;
  }

  doc.line(x1, y, x1 + ancho, y); y += 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("MONTO DEVUELTO", x1, y);
  doc.text(`Bs ${datos.monto.toFixed(2)}`, x1 + ancho, y, { align: "right" });

  const nombreArchivo = `devolucion_venta_${datos.numeroVenta}.pdf`;
  doc.save(nombreArchivo);
  return doc.output("blob");
}

interface DatosPdfGrande {
  negocio: string;
  cliente: string;
  telefono: string;
  fecha: string;
  titulo: string; // "Pedido acumulado" o "Detalle del día"
  grupos: GrupoProducto[];
  subtotalSinDescuento: number;
  descuentoTotal: number;
  total: number;
  depositado: number;
  saldoPendiente: number;
  saldoAFavor: number;
  mostrarPagos: boolean; // el PDF diario no muestra depósitos/saldo, el acumulado sí
}

// Convierte una imagen (URL pública de Supabase Storage) a dataURL para poder
// incrustarla en el PDF. Si falla (CORS, red, etc.) devuelve null y el PDF
// sigue generándose sin esa foto — nunca se simula ni se inventa una imagen.
async function cargarImagenComoDataUrl(url: string): Promise<{ dataUrl: string; formato: "PNG" | "JPEG" } | null> {
  try {
    const resp = await fetch(url, { mode: "cors" });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const formato = dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
    return { dataUrl, formato };
  } catch {
    return null;
  }
}

// PDF grande (A4), profesional, CON fotografías reales de cada producto —
// para el pedido acumulado completo del cliente o el detalle de un día.
// No es el recibo térmico (ese es un formato aparte de 80mm, sin fotos).
export async function generarPdfGrande(datos: DatosPdfGrande): Promise<Blob> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margen = 15;
  const anchoUtil = 210 - margen * 2;
  let y = margen;

  function saltoDePaginaSiNecesario(alturaNecesaria: number) {
    if (y + alturaNecesaria > 297 - margen) {
      doc.addPage();
      y = margen;
    }
  }

  doc.setFont("times", "bolditalic");
  doc.setFontSize(23);
  doc.setTextColor(156, 122, 60);
  doc.text(datos.negocio, margen, y);
  doc.setTextColor(20, 20, 20);
  y += 8;
  doc.setFontSize(13);
  doc.setTextColor(90, 80, 90);
  doc.text(datos.titulo, margen, y);
  doc.setTextColor(20, 20, 20);
  y += 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Cliente: ${datos.cliente}`, margen, y); y += 6;
  doc.text(`Teléfono: ${datos.telefono}`, margen, y); y += 6;
  doc.text(`Fecha: ${datos.fecha}`, margen, y); y += 8;
  doc.setDrawColor(200, 195, 180);
  doc.line(margen, y, margen + anchoUtil, y);
  y += 8;

  const altoImagen = 22;
  for (const g of datos.grupos) {
    saltoDePaginaSiNecesario(altoImagen + 6);
    const yInicioFila = y;

    if (g.imagen) {
      const cargada = await cargarImagenComoDataUrl(g.imagen);
      if (cargada) {
        try {
          doc.addImage(cargada.dataUrl, cargada.formato, margen, y, altoImagen, altoImagen, undefined, "FAST");
        } catch {
          // si la imagen no se puede decodificar, simplemente se omite — no se simula nada
        }
      }
    }

    const xTexto = margen + altoImagen + 6;
    const anchoTexto = anchoUtil - altoImagen - 6;
    let yTexto = yInicioFila + 4;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(`${g.codigo} · ${g.nombre}`, xTexto, yTexto, { maxWidth: anchoTexto });
    yTexto += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Cantidad total: ${g.cantidadTotal}  ·  Precio: Bs ${g.precioUnitarioFinal.toFixed(2)}  ·  Descuento: Bs ${g.descuento.toFixed(2)}`, xTexto, yTexto, { maxWidth: anchoTexto });
    yTexto += 5;

    doc.setFontSize(9);
    doc.setTextColor(110, 100, 110);
    const detalle = g.detalle.length === 1
      ? `${g.detalle[0].fecha}${g.detalle[0].vendedorNombre ? ` — ${g.detalle[0].vendedorNombre}` : ""}`
      : g.detalle.map((d) => `${d.fecha}: ${d.cantidad} un.${d.vendedorNombre ? ` (${d.vendedorNombre})` : ""}`).join("   ");
    doc.text(detalle, xTexto, yTexto, { maxWidth: anchoTexto });
    doc.setTextColor(20, 20, 20);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`Bs ${g.subtotalConDescuento.toFixed(2)}`, margen + anchoUtil, yInicioFila + 4, { align: "right" });

    y = Math.max(yInicioFila + altoImagen, yTexto + 4) + 4;
    doc.setDrawColor(230, 225, 210);
    doc.line(margen, y, margen + anchoUtil, y);
    y += 6;
  }

  saltoDePaginaSiNecesario(50);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Subtotal sin descuento", margen, y); doc.text(`Bs ${datos.subtotalSinDescuento.toFixed(2)}`, margen + anchoUtil, y, { align: "right" }); y += 6;
  doc.setTextColor(79, 111, 82);
  doc.text("Descuento por cantidad", margen, y); doc.text(`− Bs ${datos.descuentoTotal.toFixed(2)}`, margen + anchoUtil, y, { align: "right" }); y += 6;
  doc.setTextColor(20, 20, 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("TOTAL", margen, y); doc.text(`Bs ${datos.total.toFixed(2)}`, margen + anchoUtil, y, { align: "right" }); y += 8;

  if (datos.mostrarPagos) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text("Depósitos / pagos realizados", margen, y); doc.text(`Bs ${datos.depositado.toFixed(2)}`, margen + anchoUtil, y, { align: "right" }); y += 7;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    if (datos.saldoAFavor > 0) {
      doc.setTextColor(79, 111, 82);
      doc.text("SALDO A FAVOR", margen, y); doc.text(`Bs ${datos.saldoAFavor.toFixed(2)}`, margen + anchoUtil, y, { align: "right" });
    } else {
      doc.setTextColor(122, 37, 64);
      doc.text("SALDO PENDIENTE", margen, y); doc.text(`Bs ${datos.saldoPendiente.toFixed(2)}`, margen + anchoUtil, y, { align: "right" });
    }
    doc.setTextColor(20, 20, 20);
    y += 10;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text("Este documento no cierra el pedido.", margen, y);

  const nombreArchivo = `${datos.titulo.toLowerCase().replace(/\s+/g, "_")}_${datos.cliente.replace(/\s+/g, "_")}.pdf`;
  doc.save(nombreArchivo);
  return doc.output("blob");
}

interface LineaSesionPdf {
  codigo: string;
  nombre: string;
  cantidad: number;
  precio: number;
  descuento: number;
  subtotal: number;
}

interface DatosPdfSesion {
  negocio: string;
  vendedor: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  lineas: LineaSesionPdf[];
  totalVendido: number;
  devoluciones: number;
  ventaNeta: number;
  comisionTexto: string;
  comision: number;
}

// Resumen de turno/sesión de un vendedor: qué vendió, cuánto, sus
// devoluciones/correcciones y la comisión que le corresponde.
export function generarPdfSesion(datos: DatosPdfSesion): Blob {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margen = 15;
  const anchoUtil = 210 - margen * 2;
  let y = margen;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(datos.negocio, margen, y); y += 8;
  doc.setFontSize(13);
  doc.setTextColor(90, 80, 90);
  doc.text("Resumen de turno / sesión", margen, y);
  doc.setTextColor(20, 20, 20);
  y += 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Vendedor: ${datos.vendedor}`, margen, y); y += 6;
  doc.text(`Fecha: ${datos.fecha}`, margen, y); y += 6;
  doc.text(`Inicio: ${datos.horaInicio}   Fin: ${datos.horaFin}`, margen, y); y += 8;
  doc.line(margen, y, margen + anchoUtil, y); y += 7;

  doc.setFont("helvetica", "bold");
  doc.text("Código / Descripción", margen, y);
  doc.text("Cant.", margen + 95, y);
  doc.text("Precio", margen + 120, y);
  doc.text("Desc.", margen + 145, y);
  doc.text("Subtotal", margen + anchoUtil, y, { align: "right" });
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  for (const l of datos.lineas) {
    if (y > 270) { doc.addPage(); y = margen; }
    doc.text(`${l.codigo} · ${l.nombre}`, margen, y, { maxWidth: 90 });
    doc.text(String(l.cantidad), margen + 95, y);
    doc.text(`Bs ${l.precio.toFixed(2)}`, margen + 120, y);
    doc.text(`Bs ${l.descuento.toFixed(2)}`, margen + 145, y);
    doc.text(`Bs ${l.subtotal.toFixed(2)}`, margen + anchoUtil, y, { align: "right" });
    y += 6;
  }

  y += 4;
  doc.line(margen, y, margen + anchoUtil, y); y += 8;
  doc.setFontSize(11);
  doc.text("Total vendido atribuible", margen, y); doc.text(`Bs ${datos.totalVendido.toFixed(2)}`, margen + anchoUtil, y, { align: "right" }); y += 7;
  doc.setTextColor(122, 37, 64);
  doc.text("Devoluciones / correcciones", margen, y); doc.text(`Bs ${datos.devoluciones.toFixed(2)}`, margen + anchoUtil, y, { align: "right" }); y += 7;
  doc.setTextColor(20, 20, 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("VENTA NETA", margen, y); doc.text(`Bs ${datos.ventaNeta.toFixed(2)}`, margen + anchoUtil, y, { align: "right" }); y += 9;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Comisión configurada: ${datos.comisionTexto}`, margen, y); y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(79, 111, 82);
  doc.text("COMISIÓN FINAL", margen, y); doc.text(`Bs ${datos.comision.toFixed(2)}`, margen + anchoUtil, y, { align: "right" });
  doc.setTextColor(20, 20, 20);

  const nombreArchivo = `sesion_${datos.vendedor.replace(/\s+/g, "_")}_${datos.fecha.replace(/\//g, "-")}.pdf`;
  doc.save(nombreArchivo);
  return doc.output("blob");
}

// Genera el PDF (pedido abierto o recibo de cierre) y lo descarga. Devuelve el
// Blob para poder compartirlo también por WhatsApp (adjuntándolo manualmente,
// ya que un navegador normal no puede adjuntar archivos automáticamente a WhatsApp Web).
export function generarPdfPedido(datos: DatosPdfPedido): Blob {
  const doc = new jsPDF({ unit: "mm", format: [80, 200 + datos.grupos.length * 12] });
  let y = 10;
  const x1 = 5;
  const ancho = 70;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(datos.negocio, x1 + ancho / 2, y, { align: "center" });
  y += 6;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(datos.cerrado ? "Recibo de venta" : "Pedido abierto", x1 + ancho / 2, y, { align: "center" });
  y += 6;

  doc.text(`Cliente: ${datos.cliente}`, x1, y); y += 4;
  doc.text(`Teléfono: ${datos.telefono}`, x1, y); y += 4;
  doc.text(`Fecha: ${datos.fecha}`, x1, y); y += 5;
  doc.line(x1, y, x1 + ancho, y); y += 4;

  doc.setFont("helvetica", "bold");
  doc.text("Código / Descripción", x1, y);
  doc.text("Subtotal", x1 + ancho, y, { align: "right" });
  y += 4;
  doc.setFont("helvetica", "normal");

  for (const g of datos.grupos) {
    doc.setFontSize(9);
    doc.text(`${g.codigo} · ${g.nombre}`, x1, y);
    doc.text(`Bs ${g.subtotalConDescuento.toFixed(2)}`, x1 + ancho, y, { align: "right" });
    y += 4;
    doc.setFontSize(7.5);
    doc.setTextColor(110, 100, 110);
    const detalle = g.detalle.map((d) => `${d.cantidad} un. — ${d.fecha}`).join("   ");
    doc.text(`Cant. total: ${g.cantidadTotal} × Bs ${g.precioUnitarioFinal.toFixed(2)}  (${detalle})`, x1, y, { maxWidth: ancho });
    y += 6;
    doc.setTextColor(20, 20, 20);
  }

  doc.line(x1, y, x1 + ancho, y); y += 5;
  doc.setFontSize(9);
  doc.text("Subtotal sin descuento", x1, y); doc.text(`Bs ${datos.subtotalSinDescuento.toFixed(2)}`, x1 + ancho, y, { align: "right" }); y += 4;
  doc.text("Descuento por cantidad", x1, y); doc.text(`- Bs ${datos.descuentoTotal.toFixed(2)}`, x1 + ancho, y, { align: "right" }); y += 4;
  doc.setFont("helvetica", "bold");
  doc.text("TOTAL", x1, y); doc.text(`Bs ${datos.total.toFixed(2)}`, x1 + ancho, y, { align: "right" }); y += 5;
  doc.setFont("helvetica", "normal");
  doc.text("Depósitos anteriores", x1, y); doc.text(`Bs ${datos.depositado.toFixed(2)}`, x1 + ancho, y, { align: "right" }); y += 4;

  if (datos.cerrado && datos.pagoFinal && datos.pagoFinal > 0) {
    doc.text("Pago final al cerrar", x1, y); doc.text(`Bs ${datos.pagoFinal.toFixed(2)}`, x1 + ancho, y, { align: "right" }); y += 4;
    doc.setFont("helvetica", "bold");
    doc.text("TOTAL PAGADO", x1, y); doc.text(`Bs ${(datos.depositado + datos.pagoFinal).toFixed(2)}`, x1 + ancho, y, { align: "right" }); y += 4;
    doc.text("SALDO", x1, y); doc.text("Bs 0.00", x1 + ancho, y, { align: "right" }); y += 6;
  } else {
    doc.setFont("helvetica", "bold");
    doc.text("SALDO ACTUAL", x1, y); doc.text(`Bs ${datos.saldo.toFixed(2)}`, x1 + ancho, y, { align: "right" }); y += 6;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("¡Gracias por tu compra!", x1 + ancho / 2, y, { align: "center" });

  const nombreArchivo = `${datos.cerrado ? "recibo" : "pedido"}_${datos.cliente.replace(/\s+/g, "_")}.pdf`;
  doc.save(nombreArchivo);
  return doc.output("blob");
}
