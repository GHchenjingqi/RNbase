import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

export default function Home() {
  const [info, setInfo] = useState(null);
  const [dark, setDark] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    // 直接使用基座 Bridge 中间件 window.RN
    Promise.all([window.RN.APP.GETINFO(), window.RN.SYSTEM.GETDARKMODE()])
      .then(([appInfo, darkMode]) => {
        if (!alive) return;
        setInfo(appInfo);
        setDark(darkMode.mode);
      })
      .catch((e) => alive && setError(e && e.code ? `${e.code}: ${e.message}` : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div>
      <h1>H5 子应用 (React)</h1>
      <nav>
        <Link to="/">首页</Link> | <Link to="/about">关于</Link>
      </nav>
      <h2>首页</h2>
      {info && <p>App: {info.appVersion} / Bridge: {info.bridgeVersion} / {info.platform}</p>}
      {dark && <p>深色模式: <b>{dark}</b></p>}
      {error && <p style={{ color: '#b00020' }}>Bridge 调用失败: {error}</p>}
    </div>
  );
}
