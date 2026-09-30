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
  doc.text("Comprobante de devolución", x1 + ancho / 2, y, {
    align: "center",
  });
  y += 7;

  doc.text(`Cliente: ${datos.cliente}`, x1, y);
  y += 4;

  doc.text(`Venta N.º: ${datos.numeroVenta}`, x1, y);
  y += 4;

  doc.text(`Fecha: ${datos.fecha}`, x1, y);
  y += 5;

  doc.line(x1, y, x1 + ancho, y);
  y += 5;

  doc.text(`Producto: ${datos.producto}`, x1, y, { maxWidth: ancho });
  y += 5;

  doc.text(`Cantidad: ${datos.cantidad}`, x1, y);
  y += 4;

  doc.text(`Motivo: ${datos.motivo}`, x1, y, { maxWidth: ancho });
  y += 5;

  doc.text(`Forma de devolución: ${datos.formaDevolucion}`, x1, y, {
    maxWidth: ancho,
  });
  y += 5;

  if (datos.observacion) {
    doc.text(`Observación: ${datos.observacion}`, x1, y, {
      maxWidth: ancho,
    });
    y += 5;
  }

  doc.line(x1, y, x1 + ancho, y);
  y += 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);

  doc.text("MONTO DEVUELTO", x1, y);

  doc.text(`Bs ${datos.monto.toFixed(2)}`, x1 + ancho, y, {
    align: "right",
  });

  const nombreArchivo = `devolucion_venta_${datos.numeroVenta}.pdf`;

  doc.save(nombreArchivo);

  return doc.output("blob");
}

interface DatosPdfGrande {
  negocio: string;
  cliente: string;
  telefono: string;
  fecha: string;
  titulo: string;
  grupos: GrupoProducto[];
  subtotalSinDescuento: number;
  descuentoTotal: number;
  total: number;
  depositado: number;
  saldoPendiente: number;
  saldoAFavor: number;
  mostrarPagos: boolean;
}

async function cargarImagenComoDataUrl(
  url: string
): Promise<{ dataUrl: string; formato: "PNG" | "JPEG" } | null> {
  try {
    const resp = await fetch(url, {
      mode: "cors",
      cache: "no-store",
    });

    if (!resp.ok) return null;

    const blob = await resp.blob();

    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;

      reader.readAsDataURL(blob);
    });

    const formato =
      dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";

    return {
      dataUrl,
      formato,
    };
  } catch {
    return null;
  }
}

export async function generarPdfGrande(
  datos: DatosPdfGrande
): Promise<Blob> {
  const doc = new jsPDF({
    unit: "mm",
    format: "a4",
  });

  const margen = 15;
  const anchoUtil = 210 - margen * 2;

  let y = margen;

  function saltoDePaginaSiNecesario(alturaNecesaria: number) {
    if (y + alturaNecesaria > 297 - margen) {
      doc.addPage();
      y = margen;
    }
  }

  // ==========================================================
  // LOGO LOVE'S STORIES
  // ==========================================================

  try {
    const logoUrl = `${window.location.origin}/logo-loves-stories.png`;

    const logo = await cargarImagenComoDataUrl(logoUrl);

    if (logo) {
      try {
        doc.addImage(
          logo.dataUrl,
          logo.formato,
          margen,
          y,
          18,
          18,
          undefined,
          "FAST"
        );
      } catch {
        // Si el logo falla, el PDF continúa.
      }
    }
  } catch {
    // Si no se puede cargar el logo, el PDF continúa.
  }

  // ==========================================================
  // ENCABEZADO
  // ==========================================================

  doc.setFont("times", "bolditalic");
  doc.setFontSize(23);
  doc.setTextColor(214, 139, 154);

  doc.text("Love's Stories", margen + 23, y + 10);

  doc.setTextColor(20, 20, 20);

  y += 20;

  doc.setFontSize(13);
  doc.setTextColor(90, 80, 90);

  doc.text(datos.titulo, margen, y);

  doc.setTextColor(20, 20, 20);

  y += 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);

  doc.text(`Cliente: ${datos.cliente}`, margen, y);

  y += 6;

  const telefonoLimpio = (datos.telefono ?? "").replace(/\D/g, "");

  if (telefonoLimpio.length >= 7) {
    doc.text(`Teléfono: ${datos.telefono}`, margen, y);
    y += 6;
  }

  doc.text(`Fecha: ${datos.fecha}`, margen, y);

  y += 8;

  doc.setDrawColor(200, 195, 180);

  doc.line(margen, y, margen + anchoUtil, y);

  y += 8;

  // ==========================================================
  // TABLA
  // ==========================================================

  const xFoto = margen;
  const xProducto = margen + 17;
  const xCant = margen + 76;
  const xPrecio = margen + 91;
  const xDesc = margen + 113;
  const xDetalle = margen + 133;
  const xSubtotal = margen + anchoUtil;

  function encabezadoTabla() {
    doc.setFillColor(247, 243, 236);

    doc.rect(margen, y, anchoUtil, 7, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(70, 60, 70);

    doc.text("FOTO", xFoto + 1, y + 4.5);

    doc.text(
      "CÓDIGO / PRODUCTO",
      xProducto,
      y + 4.5
    );

    doc.text(
      "CANT.",
      xCant,
      y + 4.5
    );

    doc.text(
      "PRECIO",
      xPrecio,
      y + 4.5
    );

    doc.text(
      "DESC.",
      xDesc,
      y + 4.5
    );

    doc.text(
      "FECHA / VENDEDOR",
      xDetalle,
      y + 4.5
    );

    doc.text(
      "SUBTOTAL",
      xSubtotal,
      y + 4.5,
      {
        align: "right",
      }
    );

    doc.setTextColor(20, 20, 20);

    y += 7;
  }

  encabezadoTabla();

  // ==========================================================
  // PRODUCTOS
  // ==========================================================

  for (const g of datos.grupos) {
    let imagenCargada: Awaited<
      ReturnType<typeof cargarImagenComoDataUrl>
    > = null;

    if (g.imagen) {
      try {
        imagenCargada =
          await cargarImagenComoDataUrl(g.imagen);
      } catch {
        imagenCargada = null;
      }
    }

    const tieneImagen = !!imagenCargada;

    // ========================================================
    // TODAS LAS FECHAS Y VENDEDORES
    // ========================================================

    const detalle =
      g.detalle.length === 1
        ? `${g.detalle[0].fecha}${
            g.detalle[0].vendedorNombre
              ? ` · ${g.detalle[0].vendedorNombre}`
              : " · Sin vendedor"
          }`
        : g.detalle
            .map(
              (d) =>
                `${d.fecha}: ${d.cantidad} un.${
                  d.vendedorNombre
                    ? ` · ${d.vendedorNombre}`
                    : " · Sin vendedor"
                }`
            )
            .join(" / ");

    doc.setFontSize(6.2);

    const lineasDetalle =
      doc.splitTextToSize(detalle, 31);

    const altoPorDetalle = Math.max(
      8,
      lineasDetalle.length * 3.2 + 3
    );

    const altoFila = Math.max(
      tieneImagen ? 17 : 8,
      altoPorDetalle
    );

    // ========================================================
    // CAMBIO DE PÁGINA
    // ========================================================

    if (y + altoFila > 297 - margen) {
      doc.addPage();

      y = margen;

      encabezadoTabla();
    }

    const yInicio = y;

    // ========================================================
    // FOTO
    // ========================================================

    if (imagenCargada) {
      try {
        doc.addImage(
          imagenCargada.dataUrl,
          imagenCargada.formato,
          xFoto,
          yInicio + 1,
          14,
          14,
          undefined,
          "FAST"
        );
      } catch {
        // Si una foto falla, el PDF continúa.
      }
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(150, 145, 145);

      doc.text(
        "—",
        xFoto + 6,
        yInicio + 4.8
      );
    }

    // ========================================================
    // PRODUCTO
    // ========================================================

    doc.setTextColor(20, 20, 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);

    doc.text(
      `${g.codigo} · ${g.nombre}`,
      xProducto,
      yInicio + 4.8,
      {
        maxWidth: 56,
      }
    );

    // ========================================================
    // CANTIDAD
    // ========================================================

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);

    doc.text(
      String(g.cantidadTotal),
      xCant + 5,
      yInicio + 4.8,
      {
        align: "center",
      }
    );

    // ========================================================
    // PRECIO
    // ========================================================

    doc.text(
      `Bs ${g.precioUnitarioFinal.toFixed(2)}`,
      xPrecio,
      yInicio + 4.8
    );

    // ========================================================
    // DESCUENTO
    // ========================================================

    doc.text(
      `Bs ${g.descuento.toFixed(2)}`,
      xDesc,
      yInicio + 4.8
    );

    // ========================================================
    // FECHAS / VENDEDORES
    // ========================================================

    doc.setFontSize(6.2);
    doc.setTextColor(100, 90, 100);

    doc.text(
      lineasDetalle,
      xDetalle,
      yInicio + 4.8
    );

    // ========================================================
    // SUBTOTAL
    // ========================================================

    doc.setTextColor(20, 20, 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);

    doc.text(
      `Bs ${g.subtotalConDescuento.toFixed(2)}`,
      xSubtotal,
      yInicio + 4.8,
      {
        align: "right",
      }
    );

    // ========================================================
    // FINAL DE FILA
    // ========================================================

    y += altoFila;

    doc.setDrawColor(225, 220, 215);

    doc.line(
      margen,
      y,
      margen + anchoUtil,
      y
    );
  }

  // ==========================================================
  // TOTALES
  // ==========================================================

  y += 5;

  saltoDePaginaSiNecesario(50);
const cantidadTotal = datos.grupos.reduce(
  (total, g) => total + g.cantidadTotal,
  0
);

doc.setFont("helvetica", "bold");
doc.setFontSize(11);
doc.setTextColor(20, 20, 20);

doc.text(
  "CANTIDAD TOTAL DE JOYAS",
  margen,
  y
);

doc.text(
  `${cantidadTotal} unidades`,
  margen + anchoUtil,
  y,
  {
    align: "right",
  }
);

y += 7;
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(20, 20, 20);

  doc.text(
    "Subtotal sin descuento",
    margen,
    y
  );

  doc.text(
    `Bs ${datos.subtotalSinDescuento.toFixed(2)}`,
    margen + anchoUtil,
    y,
    {
      align: "right",
    }
  );

  y += 6;

  doc.setTextColor(79, 111, 82);

  doc.text(
    "Descuento por cantidad",
    margen,
    y
  );

  doc.text(
    `Bs ${datos.descuentoTotal.toFixed(2)}`,
    margen + anchoUtil,
    y,
    {
      align: "right",
    }
  );

  y += 6;

  doc.setTextColor(20, 20, 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);

  doc.text(
    "TOTAL",
    margen,
    y
  );

  doc.text(
    `Bs ${datos.total.toFixed(2)}`,
    margen + anchoUtil,
    y,
    {
      align: "right",
    }
  );

  y += 8;

  // ==========================================================
  // PIE
  // ==========================================================

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);

  doc.text(
    "Este documento no cierra el pedido.",
    margen,
    y
  );

  const nombreArchivo =
    `${datos.titulo
      .toLowerCase()
      .replace(/\s+/g, "_")}_` +
    `${datos.cliente.replace(/\s+/g, "_")}.pdf`;

  const pdfBlob = doc.output("blob");

  try {
    doc.save(nombreArchivo);
  } catch {
    // Si el navegador bloquea la descarga,
    // se sigue devolviendo el Blob.
  }

  return pdfBlob;
}

// ============================================================
// PDF DE SESIÓN / VENDEDOR
// ============================================================

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

export function generarPdfSesion(
  datos: DatosPdfSesion
): Blob {
  const doc = new jsPDF({
    unit: "mm",
    format: "a4",
  });

  const margen = 15;
  const anchoUtil = 210 - margen * 2;

  let y = margen;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);

  doc.text(
    datos.negocio,
    margen,
    y
  );

  y += 8;

  doc.setFontSize(13);
  doc.setTextColor(90, 80, 90);

  doc.text(
    "Resumen de turno / sesión",
    margen,
    y
  );

  doc.setTextColor(20, 20, 20);

  y += 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);

  doc.text(
    `Vendedor: ${datos.vendedor}`,
    margen,
    y
  );

  y += 6;

  doc.text(
    `Fecha: ${datos.fecha}`,
    margen,
    y
  );

  y += 6;

  doc.text(
    `Inicio: ${datos.horaInicio}   Fin: ${datos.horaFin}`,
    margen,
    y
  );

  y += 8;

  doc.line(
    margen,
    y,
    margen + anchoUtil,
    y
  );

  y += 7;

  doc.setFont("helvetica", "bold");

  doc.text(
    "Código / Descripción",
    margen,
    y
  );

  doc.text(
    "Cant.",
    margen + 95,
    y
  );

  doc.text(
    "Precio",
    margen + 120,
    y
  );

  doc.text(
    "Desc.",
    margen + 145,
    y
  );

  doc.text(
    "Subtotal",
    margen + anchoUtil,
    y,
    {
      align: "right",
    }
  );

  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  for (const l of datos.lineas) {
    if (y > 270) {
      doc.addPage();

      y = margen;
    }

    doc.text(
      `${l.codigo} · ${l.nombre}`,
      margen,
      y,
      {
        maxWidth: 90,
      }
    );

    doc.text(
      String(l.cantidad),
      margen + 95,
      y
    );

    doc.text(
      `Bs ${l.precio.toFixed(2)}`,
      margen + 120,
      y
    );

    doc.text(
      `Bs ${l.descuento.toFixed(2)}`,
      margen + 145,
      y
    );

    doc.text(
      `Bs ${l.subtotal.toFixed(2)}`,
      margen + anchoUtil,
      y,
      {
        align: "right",
      }
    );

    y += 6;
  }

  y += 4;

  doc.line(
    margen,
    y,
    margen + anchoUtil,
    y
  );

  y += 8;

  doc.setFontSize(11);

  doc.text(
    "Total vendido atribuible",
    margen,
    y
  );

  doc.text(
    `Bs ${datos.totalVendido.toFixed(2)}`,
    margen + anchoUtil,
    y,
    {
      align: "right",
    }
  );

  y += 7;

  doc.setTextColor(122, 37, 64);

  doc.text(
    "Devoluciones / correcciones",
    margen,
    y
  );

  doc.text(
    `Bs ${datos.devoluciones.toFixed(2)}`,
    margen + anchoUtil,
    y,
    {
      align: "right",
    }
  );

  y += 7;

  doc.setTextColor(20, 20, 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);

  doc.text(
    "VENTA NETA",
    margen,
    y
  );

  doc.text(
    `Bs ${datos.ventaNeta.toFixed(2)}`,
    margen + anchoUtil,
    y,
    {
      align: "right",
    }
  );

  y += 9;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  doc.text(
    `Comisión configurada: ${datos.comisionTexto}`,
    margen,
    y
  );

  y += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(79, 111, 82);

  doc.text(
    "COMISIÓN FINAL",
    margen,
    y
  );

  doc.text(
    `Bs ${datos.comision.toFixed(2)}`,
    margen + anchoUtil,
    y,
    {
      align: "right",
    }
  );

  doc.setTextColor(20, 20, 20);

  const nombreArchivo =
    `sesion_${datos.vendedor.replace(/\s+/g, "_")}_` +
    `${datos.fecha.replace(/\//g, "-")}.pdf`;

  doc.save(nombreArchivo);

  return doc.output("blob");
}

// ============================================================
// PDF PEDIDO / RECIBO 80 MM
// ============================================================

export function generarPdfPedido(
  datos: DatosPdfPedido
): Blob {
  const doc = new jsPDF({
    unit: "mm",
    format: [
      80,
      200 + datos.grupos.length * 12,
    ],
  });

  let y = 10;

  const x1 = 5;
  const ancho = 70;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);

  doc.text(
    datos.negocio,
    x1 + ancho / 2,
    y,
    {
      align: "center",
    }
  );

  y += 6;

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");

  doc.text(
    datos.cerrado
      ? "Recibo de venta"
      : "Pedido abierto",
    x1 + ancho / 2,
    y,
    {
      align: "center",
    }
  );

  y += 6;

  doc.text(
    `Cliente: ${datos.cliente}`,
    x1,
    y
  );

  y += 4;

  const telefonoLimpio =
    (datos.telefono ?? "").replace(/\D/g, "");

  if (telefonoLimpio.length >= 7) {
    doc.text(
      `Teléfono: ${datos.telefono}`,
      x1,
      y
    );

    y += 4;
  }

  doc.text(
    `Fecha: ${datos.fecha}`,
    x1,
    y
  );

  y += 5;

  doc.line(
    x1,
    y,
    x1 + ancho,
    y
  );

  y += 4;

  doc.setFont("helvetica", "bold");

  doc.text(
    "Código / Descripción",
    x1,
    y
  );

  doc.text(
    "Subtotal",
    x1 + ancho,
    y,
    {
      align: "right",
    }
  );

  y += 4;

  doc.setFont("helvetica", "normal");

  for (const g of datos.grupos) {
    doc.setFontSize(9);

    doc.text(
      `${g.codigo} · ${g.nombre}`,
      x1,
      y
    );

    doc.text(
      `Bs ${g.subtotalConDescuento.toFixed(2)}`,
      x1 + ancho,
      y,
      {
        align: "right",
      }
    );

    y += 4;

    doc.setFontSize(7.5);
    doc.setTextColor(110, 100, 110);

    const detalle = g.detalle
      .map(
        (d) =>
          `${d.cantidad} un. — ${d.fecha}`
      )
      .join("   ");

    doc.text(
      `Cant. total: ${g.cantidadTotal} × Bs ${g.precioUnitarioFinal.toFixed(
        2
      )}  (${detalle})`,
      x1,
      y,
      {
        maxWidth: ancho,
      }
    );

    y += 6;

    doc.setTextColor(20, 20, 20);
  }

  doc.line(
    x1,
    y,
    x1 + ancho,
    y
  );

  y += 5;

  doc.setFontSize(9);

  doc.text(
    "Subtotal sin descuento",
    x1,
    y
  );

  doc.text(
    `Bs ${datos.subtotalSinDescuento.toFixed(2)}`,
    x1 + ancho,
    y,
    {
      align: "right",
    }
  );

  y += 4;

  doc.text(
    "Descuento por cantidad",
    x1,
    y
  );

  doc.text(
    `Bs ${datos.descuentoTotal.toFixed(2)}`,
    x1 + ancho,
    y,
    {
      align: "right",
    }
  );

  y += 4;

  doc.setFont("helvetica", "bold");

  doc.text(
    "TOTAL",
    x1,
    y
  );

  doc.text(
    `Bs ${datos.total.toFixed(2)}`,
    x1 + ancho,
    y,
    {
      align: "right",
    }
  );

  y += 5;

  doc.setFont("helvetica", "normal");

  doc.text(
    "Depósitos anteriores",
    x1,
    y
  );

  doc.text(
    `Bs ${datos.depositado.toFixed(2)}`,
    x1 + ancho,
    y,
    {
      align: "right",
    }
  );

  y += 4;

  if (
    datos.cerrado &&
    datos.pagoFinal &&
    datos.pagoFinal > 0
  ) {
    doc.text(
      "Pago final al cerrar",
      x1,
      y
    );

    doc.text(
      `Bs ${datos.pagoFinal.toFixed(2)}`,
      x1 + ancho,
      y,
      {
        align: "right",
      }
    );

    y += 4;

    doc.setFont("helvetica", "bold");

    doc.text(
      "TOTAL PAGADO",
      x1,
      y
    );

    doc.text(
      `Bs ${(datos.depositado + datos.pagoFinal).toFixed(2)}`,
      x1 + ancho,
      y,
      {
        align: "right",
      }
    );

    y += 4;

    doc.text(
      "SALDO",
      x1,
      y
    );

    doc.text(
      "Bs 0.00",
      x1 + ancho,
      y,
      {
        align: "right",
      }
    );

    y += 6;
  } else {
    doc.setFont("helvetica", "bold");

    doc.text(
      "SALDO ACTUAL",
      x1,
      y
    );

    doc.text(
      `Bs ${datos.saldo.toFixed(2)}`,
      x1 + ancho,
      y,
      {
        align: "right",
      }
    );

    y += 6;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  doc.text(
    "¡Gracias por tu compra!",
    x1 + ancho / 2,
    y,
    {
      align: "center",
    }
  );

  const nombreArchivo =
    `${datos.cerrado ? "recibo" : "pedido"}_` +
    `${datos.cliente.replace(/\s+/g, "_")}.pdf`;

  doc.save(nombreArchivo);

  return doc.output("blob");
}
// ============================================================
// PDF PEDIDO POR CATÁLOGO
// ============================================================

export interface ItemPdfCatalogo {
  codigo: string;
  nombre: string;
  imagen: string | null;
  cantidad: number;
  precio: number;
  variante?: string | null;
}

export interface DatosPdfCatalogo {
  negocio: string;
  codigoPedido: string;
  cliente: string;
  telefono: string;
  fecha: string;
  items: ItemPdfCatalogo[];
  totalUnidades: number;
  total: number;
}

export async function generarPdfCatalogo(
  datos: DatosPdfCatalogo
): Promise<Blob> {
  const doc = new jsPDF({
    unit: "mm",
    format: "a4",
  });

  const margen = 15;
  const anchoUtil = 210 - margen * 2;
  let y = margen;

  // LOGO
  try {
    const logoUrl = `${window.location.origin}/logo-loves-stories.png`;
    const logo = await cargarImagenComoDataUrl(logoUrl);

    if (logo) {
      doc.addImage(
        logo.dataUrl,
        logo.formato,
        margen,
        y,
        18,
        18,
        undefined,
        "FAST"
      );
    }
  } catch {
    // El PDF continúa aunque el logo no cargue.
  }

  // ENCABEZADO
  doc.setFont("times", "bolditalic");
  doc.setFontSize(23);
  doc.setTextColor(214, 139, 154);
  doc.text("Love's Stories", margen + 23, y + 10);

  doc.setTextColor(20, 20, 20);
  y += 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(90, 80, 90);
  doc.text("PEDIDO POR CATÁLOGO", margen, y);

  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(20, 20, 20);

  doc.text(`N.º de pedido: ${datos.codigoPedido}`, margen, y);
  y += 5;

  doc.text(`Cliente: ${datos.cliente}`, margen, y);
  y += 5;

  const telefonoLimpio = (datos.telefono ?? "").replace(/\D/g, "");

  if (telefonoLimpio.length >= 7) {
    doc.text(`Teléfono: ${datos.telefono}`, margen, y);
    y += 5;
  }

  doc.text(`Fecha: ${datos.fecha}`, margen, y);
  y += 7;

  doc.setDrawColor(200, 195, 180);
  doc.line(margen, y, margen + anchoUtil, y);
  y += 6;

  // COLUMNAS
  const xFoto = margen;
  const xProducto = margen + 20;
  const xCant = margen + 105;
  const xPrecio = margen + 125;
  const xSubtotal = margen + anchoUtil;

  function encabezadoTabla() {
    doc.setFillColor(247, 243, 236);
    doc.rect(margen, y, anchoUtil, 7, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(70, 60, 70);

    doc.text("FOTO", xFoto + 1, y + 4.5);
    doc.text("CÓDIGO / PRODUCTO", xProducto, y + 4.5);
    doc.text("CANT.", xCant, y + 4.5);
    doc.text("PRECIO", xPrecio, y + 4.5);
    doc.text("SUBTOTAL", xSubtotal, y + 4.5, {
      align: "right",
    });

    doc.setTextColor(20, 20, 20);
    y += 7;
  }

  encabezadoTabla();

  // PRODUCTOS
  for (const item of datos.items) {
    let imagenCargada: Awaited<
      ReturnType<typeof cargarImagenComoDataUrl>
    > = null;

    if (item.imagen) {
      try {
        imagenCargada = await cargarImagenComoDataUrl(item.imagen);
      } catch {
        imagenCargada = null;
      }
    }

    const altoFila = imagenCargada ? 19 : 13;

    if (y + altoFila > 282) {
      doc.addPage();
      y = margen;
      encabezadoTabla();
    }

    const yInicio = y;

    // FOTO
    if (imagenCargada) {
      try {
        doc.addImage(
          imagenCargada.dataUrl,
          imagenCargada.formato,
          xFoto,
          yInicio + 1,
          16,
          16,
          undefined,
          "FAST"
        );
      } catch {
        // Continúa sin foto.
      }
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(150, 145, 145);
      doc.text("—", xFoto + 7, yInicio + 5);
    }

    // PRODUCTO
    doc.setTextColor(20, 20, 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);

    doc.text(
      `${item.codigo} · ${item.nombre}`,
      xProducto,
      yInicio + 5,
      { maxWidth: 80 }
    );

    if (item.variante) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(122, 95, 45);

      doc.text(
        item.variante,
        xProducto,
        yInicio + 10,
        { maxWidth: 80 }
      );
    }

    // CANTIDAD
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(20, 20, 20);

    doc.text(
      String(item.cantidad),
      xCant + 5,
      yInicio + 5,
      { align: "center" }
    );

    // PRECIO
    doc.text(
      `Bs ${item.precio.toFixed(2)}`,
      xPrecio,
      yInicio + 5
    );

    // SUBTOTAL
    doc.setFont("helvetica", "bold");

    doc.text(
      `Bs ${(item.precio * item.cantidad).toFixed(2)}`,
      xSubtotal,
      yInicio + 5,
      { align: "right" }
    );

    y += altoFila;

    doc.setDrawColor(225, 220, 215);
    doc.line(margen, y, margen + anchoUtil, y);
  }

  // TOTALES
  y += 7;

  if (y > 265) {
    doc.addPage();
    y = margen;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(20, 20, 20);

  doc.text("Total de unidades", margen, y);

  doc.text(
    String(datos.totalUnidades),
    margen + anchoUtil,
    y,
    { align: "right" }
  );

  y += 7;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);

  doc.text("TOTAL", margen, y);

  doc.text(
    `Bs ${datos.total.toFixed(2)}`,
    margen + anchoUtil,
    y,
    { align: "right" }
  );

  y += 12;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);

  doc.text(
    "Pedido realizado mediante el catálogo de Love's Stories.",
    margen,
    y
  );

  const nombreArchivo =
    `pedido_catalogo_${datos.codigoPedido}_` +
    `${datos.cliente.replace(/\s+/g, "_")}.pdf`;

  const pdfBlob = doc.output("blob");

  try {
    doc.save(nombreArchivo);
  } catch {
    // Si el navegador bloquea la descarga, igualmente devolvemos el Blob.
  }

  return pdfBlob;
}
