import React, { useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";

interface Props {
  onCapturar: (file: File) => void;
  onCerrar: () => void;
}

// Cámara real con navigator.mediaDevices.getUserMedia: pide permiso, muestra
// preview de video (funciona con webcam en PC y cámara trasera en celular vía
// facingMode: "environment"), permite tomar la foto o cancelar, y SIEMPRE
// detiene todas las pistas del MediaStream (tracks) al capturar, cancelar,
// cerrar o desmontar — para no dejar la cámara encendida de fondo.
export default function CamaraCaptura({ onCapturar, onCerrar }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    let cancelado = false;

    async function iniciar() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Este navegador no soporta acceso a la cámara (getUserMedia no disponible).");
        return;
      }
      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        } catch {
          // Si no hay cámara trasera (típico en PC/webcam), se pide cualquier cámara disponible.
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
        if (cancelado) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setListo(true);
      } catch (e: any) {
        setError(e?.message || "No se pudo acceder a la cámara. Revisa los permisos del navegador.");
      }
    }

    iniciar();
    return () => {
      cancelado = true;
      detenerCamara();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function detenerCamara() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function tomarFoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], `foto_${Date.now()}.jpg`, { type: "image/jpeg" });
        detenerCamara();
        onCapturar(file);
      }
    }, "image/jpeg", 0.9);
  }

  function cancelar() {
    detenerCamara();
    onCerrar();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(43,30,46,0.85)" }}>
      <div className="w-full max-w-sm rounded-md p-4" style={{ background: "#F7F3EC" }}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-serif">Cámara</p>
          <button onClick={cancelar} className="p-1" aria-label="Cerrar"><X size={16} /></button>
        </div>

        {error ? (
          <p className="text-xs p-3 rounded mb-3" style={{ background: "#F4E3E6", color: "#7A2540" }}>{error}</p>
        ) : (
          <video ref={videoRef} playsInline muted className="w-full rounded-md mb-3" style={{ background: "#000", aspectRatio: "4 / 3", objectFit: "cover" }} />
        )}

        <div className="flex gap-2">
          <button onClick={tomarFoto} disabled={!listo} className="flex-1 py-2 rounded-md text-sm flex items-center justify-center gap-2"
            style={{ background: listo ? "#9C7A3C" : "#D9D0C2", color: "#F7F3EC" }}>
            <Camera size={15} /> Tomar foto
          </button>
          <button onClick={cancelar} className="flex-1 py-2 rounded-md text-sm" style={{ background: "#EDE7DE", border: "1px solid #D9D0C2" }}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
