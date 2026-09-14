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
