import { useEffect, useRef } from "react";

/** An image shown large over the page; Escape or any click closes it. */
export function Lightbox({ src, onClose }: { src: string | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (src) dialog.current?.showModal();
    else dialog.current?.close();
  }, [src]);

  return (
    <dialog ref={dialog} className="lightbox" onClose={onClose} onClick={() => dialog.current?.close()}>
      {src && <img src={src} alt="" />}
    </dialog>
  );
}
