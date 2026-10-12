export default function About() {
  return (
    <div>
      <h1>H5 子应用 (React)</h1>
      <p>这是 hash 路由的第二个页面。</p>
      <button
        onClick={() => window.RN.SYSTEM.VIBRATE({ duration: 200 }).catch(() => {})}
        style={{ padding: '8px 16px', fontSize: 14 }}
      >
        震动一下 (RN.SYSTEM.VIBRATE)
      </button>
    </div>
  );
}
