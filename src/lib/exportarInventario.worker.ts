import ExcelJS from "exceljs";

export interface ProductoExportable {
  codigo: string;
  descripcion: string;
  costo: number;
  precio: number;
  fisico: number;
  reservado: number;
  disponible: number;
  lote: string;
  imagen: string;
}

export type ResultadoExportacion =
  | { tipo: "archivo"; archivo: Blob }
  | { tipo: "error"; mensaje: string };

self.addEventListener("message", async ({ data: productos }: MessageEvent<ProductoExportable[]>) => {
  try {
    const libro = new ExcelJS.Workbook();
    const hoja = libro.addWorksheet("Inventario");
    hoja.columns = [
      { header: "Código", key: "codigo", width: 14 },
      { header: "Descripción", key: "descripcion", width: 28 },
      { header: "Costo", key: "costo", width: 13 },
      { header: "Precio de venta", key: "precio", width: 16 },
      { header: "Ganancia", key: "ganancia", width: 14 },
      { header: "Stock físico", key: "fisico", width: 13 },
      { header: "Stock reservado", key: "reservado", width: 15 },
      { header: "Stock disponible", key: "disponible", width: 15 },
      { header: "Lote", key: "lote", width: 22 },
      { header: "Imagen", key: "imagen", width: 26 },
      { header: "Estado", key: "estado", width: 14 },
    ];
    hoja.getRow(1).font = { bold: true };
    hoja.views = [{ state: "frozen", ySplit: 1 }];
    for (const columna of ["costo", "precio", "ganancia"]) {
      hoja.getColumn(columna).numFmt = '"Bs" #,##0.00';
    }
    for (const producto of productos) {
      hoja.addRow({
        ...producto,
        ganancia: producto.precio - producto.costo,
        estado: producto.disponible > 0 ? "Disponible" : "Agotado",
      });
    }
    hoja.autoFilter = `A1:K${hoja.rowCount}`;

    const buffer = await libro.xlsx.writeBuffer();
    const archivo = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    self.postMessage({ tipo: "archivo", archivo } satisfies ResultadoExportacion);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    self.postMessage({ tipo: "error", mensaje } satisfies ResultadoExportacion);
  }
});
