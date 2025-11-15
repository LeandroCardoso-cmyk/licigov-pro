export default function TestPage() {
  return (
    <div style={{ padding: '50px', backgroundColor: '#f0f0f0' }}>
      <h1 style={{ color: 'red', fontSize: '32px', marginBottom: '20px' }}>
        PÁGINA DE TESTE - HTML PURO
      </h1>
      
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>
          Input HTML Nativo:
        </label>
        <input 
          type="text" 
          placeholder="Digite aqui..."
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

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>
          Textarea HTML Nativo:
        </label>
        <textarea 
          placeholder="Digite aqui..."
          rows={4}
          style={{
            width: '100%',
            padding: '10px',
            fontSize: '16px',
            border: '2px solid blue',
            backgroundColor: 'white',
            color: 'black'
          }}
        />
      </div>

      <button 
        onClick={() => alert('Botão clicado!')}
        style={{
          padding: '15px 30px',
          fontSize: '18px',
          backgroundColor: 'green',
          color: 'white',
          border: 'none',
          cursor: 'pointer'
        }}
      >
        Clique Aqui
      </button>
    </div>
  );
}
