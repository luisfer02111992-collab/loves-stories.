import React from "react";
import Clientes from "./Clientes";

/**
 * Vista aislada para teléfonos Android. Reutiliza la lógica probada de Clientes
 * (pedidos, descuentos, PDF, WhatsApp), pero tiene un contenedor de desplazamiento
 * independiente del diseño de escritorio.
 */
export default function ClientesAndroid() {
  return (
    <section className="ls-clientes-android" aria-label="Clientes Android">
      <Clientes />
    </section>
  );
}
