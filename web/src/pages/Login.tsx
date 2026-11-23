import { useState, type FormEvent } from 'react';
import { LogIn, Lock, Mail, Pickaxe } from 'lucide-react';
import { errorMessage } from '../api';
import { Button } from '../components/ui';
import { useAuth } from '../state/Auth';

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand" style={{ justifyContent: 'center', fontSize: 40 }}>
          <span className="brand-mark" style={{ width: 52, height: 52 }}>
            <Pickaxe size={32} strokeWidth={2.6} />
          </span>
          MAICRA
        </div>
        <h1 className="login-title">Welcome back</h1>

        <label className="field">
          <span className="field-label">Email</span>
          <span className="input-icon">
            <Mail size={18} />
            <input
              className="input input-light"
              type="email"
              autoComplete="username"
              autoFocus
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </span>
        </label>

        <label className="field">
          <span className="field-label">Password</span>
          <span className="input-icon">
            <Lock size={18} />
            <input
              className="input input-light"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Your password"
            />
          </span>
        </label>

        {error ? (
          <div className="form-error" role="alert">
            {error}
          </div>
        ) : null}

        <Button type="submit" size="lg" busy={busy} disabled={!email || !password}>
          <LogIn size={20} />
          Login
        </Button>
      </form>
    </div>
  );
}
