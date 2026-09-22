"use strict";
const form=document.getElementById("fit-check");
form.addEventListener("submit",event=>{
 event.preventDefault();
 const answers=new FormData(form);
 let message;
 if(!answers.has("computer")) message="Empieza por preparar un computador. Puedes leer la guía gratuita en el celular, pero el editor trabaja con archivos y herramientas locales.";
 else if(!answers.has("host")) message="Prepara primero Claude Code o Codex con tu propia cuenta. Una conversación normal en el navegador no ejecuta el kit. Consulta la guía gratuita antes de comprar.";
 else if(!answers.has("review")) message="Reserva una prueba corta antes de un proyecto importante. Necesitarás revisar transcripción, cortes y borrador; la guía te acompaña en ese proceso.";
 else message="Tienes el punto de partida para explorar el kit. Revisa la compatibilidad de tu ruta y empieza con un clip de 20–60 segundos. Esta lista no verifica la instalación ni garantiza el resultado.";
 document.getElementById("fit-result").textContent=message;
});
