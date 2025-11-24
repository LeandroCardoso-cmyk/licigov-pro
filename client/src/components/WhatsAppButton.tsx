import { MessageCircle } from "lucide-react";

/**
 * Botão flutuante do WhatsApp
 * Fixo no canto inferior direito com animação pulse
 */
export default function WhatsAppButton() {
  // Número de WhatsApp (formato internacional sem + e espaços)
  // Exemplo: 5511999999999 para +55 11 99999-9999
  const whatsappNumber = "5511999999999"; // TODO: Substituir pelo número real
  const message = encodeURIComponent("Olá! Gostaria de saber mais sobre o LiciGov Pro.");
  
  const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${message}`;

  return (
    <a
      href={whatsappUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-6 right-6 z-50 bg-green-500 hover:bg-green-600 text-white rounded-full p-4 shadow-2xl hover:shadow-3xl transition-all duration-300 animate-pulse hover:animate-none group"
      aria-label="Falar no WhatsApp"
    >
      <MessageCircle className="h-6 w-6 group-hover:scale-110 transition-transform" />
      
      {/* Tooltip */}
      <span className="absolute right-full mr-3 top-1/2 transform -translate-y-1/2 bg-gray-900 text-white text-sm px-3 py-2 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        Fale conosco no WhatsApp
      </span>
    </a>
  );
}
