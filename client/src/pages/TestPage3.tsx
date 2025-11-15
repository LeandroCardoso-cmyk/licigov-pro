import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/_core/hooks/useAuth";

export default function TestPage3() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div style={{ padding: '50px' }}>Carregando...</div>;
  }

  return (
    <div style={{ padding: '50px', backgroundColor: '#f0f0f0' }}>
      <h1 style={{ color: 'red', fontSize: '32px', marginBottom: '20px' }}>
        TESTE 3 - COM useAuth
      </h1>
      
      <div style={{ marginBottom: '20px', padding: '10px', backgroundColor: 'yellow' }}>
        <strong>User:</strong> {user ? user.name : 'Não autenticado'}
      </div>

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
