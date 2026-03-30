'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmail, signUpWithEmail, signInWithGoogle, signOut } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

export default function AuthPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState('');

  if (loading) return <div style={{ padding: '40px', textAlign: 'center' }}>Loading...</div>;

  if (user) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px',
      }}>
        <h2 style={{ marginBottom: '16px' }}>Signed in as {user.email}</h2>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={() => router.push('/sessions')} style={btnStyle}>
            View Sessions
          </button>
          <button onClick={() => signOut()} style={{ ...btnStyle, background: '#333' }}>
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (isSignUp) {
        await signUpWithEmail(email, password);
      } else {
        await signInWithEmail(email, password);
      }
      router.push('/sessions');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleGoogle = async () => {
    try {
      await signInWithGoogle();
      // Redirect handled by OAuth callback
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px',
    }}>
      <div style={{
        background: '#1a1d27',
        border: '1px solid #2a2d3a',
        borderRadius: '12px',
        padding: '32px',
        width: '100%',
        maxWidth: '400px',
      }}>
        <h2 style={{ marginBottom: '24px', textAlign: 'center' }}>
          {isSignUp ? 'Create Account' : 'Sign In'}
        </h2>

        <form onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            style={inputStyle}
          />
          {error && <p style={{ color: '#f87171', fontSize: '14px', marginBottom: '12px' }}>{error}</p>}
          <button type="submit" style={{ ...btnStyle, width: '100%', marginBottom: '12px' }}>
            {isSignUp ? 'Sign Up' : 'Sign In'}
          </button>
        </form>

        <button onClick={handleGoogle} style={{
          ...btnStyle,
          width: '100%',
          background: '#333',
          marginBottom: '16px',
        }}>
          Continue with Google
        </button>

        <p style={{ textAlign: 'center', fontSize: '14px', color: '#888' }}>
          {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            onClick={() => setIsSignUp(!isSignUp)}
            style={{ background: 'none', border: 'none', color: '#60a5fa', fontSize: '14px' }}
          >
            {isSignUp ? 'Sign In' : 'Sign Up'}
          </button>
        </p>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px',
  marginBottom: '12px',
  background: '#0f1117',
  border: '1px solid #2a2d3a',
  borderRadius: '8px',
  color: '#e0e0e0',
  fontSize: '14px',
  outline: 'none',
};

const btnStyle: React.CSSProperties = {
  padding: '12px 24px',
  background: '#4ade80',
  color: '#000',
  border: 'none',
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: 600,
};
