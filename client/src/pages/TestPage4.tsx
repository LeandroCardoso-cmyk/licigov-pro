import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function TestPage4() {
  return (
    <div style={{ padding: '50px', backgroundColor: '#f0f0f0' }}>
      <h1 style={{ color: 'red', fontSize: '32px', marginBottom: '20px' }}>
        TESTE 4 - Renderizado via AuthenticatedRoute
      </h1>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>
          Input shadcn/ui:
        </label>
        <Input 
          type="text" 
          placeholder="Digite aqui no Input do shadcn..."
        />
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>
          Input HTML Nativo (controle):
        </label>
        <input 
          type="text" 
          placeholder="Digite aqui no HTML nativo..."
          style={{
            width: '100%',
            padding: '10px',
            fontSize: '16px',
            border: '2px solid red',
            backgroundColor: 'white',
            color: 'black'
          }}
        />
      </div>

      <Button onClick={() => alert('Botão clicado!')}>
        Botão shadcn/ui
      </Button>
    </div>
  );
}
