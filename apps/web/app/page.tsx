export default function Home() {
  const mode = process.env.ECOM_MODE ?? 'MOCK';
  return (
    <main style={{ fontFamily: 'system-ui', margin: '3rem auto', maxWidth: 760 }}>
      <p style={{ color: '#666' }}>ECOM · Panel operativo</p>
      <h1>Entorno inicial listo para depurar</h1>
      <p>Modo actual: <strong>{mode}</strong></p>
      <p>Los datos, credenciales e integraciones reales se habilitan de forma progresiva. Ninguna publicación, pedido o acción financiera se ejecuta desde este estado inicial.</p>
    </main>
  );
}
