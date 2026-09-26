import { userMessage } from '../lib/userMessages';
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import './Auth.css'
import henIcon from '../assets/brand/hensense-logo.png'

export default function Login() {
  const { signIn, user, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!authLoading && user) {
    return <Navigate to="/" replace />
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())){setError('Enter a valid email address.');return}
    if(!password){setError('Enter your password.');return}
    setError('')
    setSubmitting(true)

    try {
      await signIn(email.trim(), password)
      navigate('/')
    } catch (err) {
      setError(
        userMessage(err, 'Unable to sign in. Please try again.')
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-brand-panel">
        <div className="auth-brand">
          <div className="auth-brand-logo-frame">
            <span className="auth-brand-wordmark" aria-label="HenSense">
              <img src={henIcon} className="auth-brand-wordmark-icon" alt="" />
              <span className="auth-brand-wordmark-name"><span>Hen</span><span>Sense</span></span>
            </span>
          </div>
        </div>

        <div className="auth-brand-content">
          <span className="auth-eyebrow">SMART POULTRY MONITORING</span>

          <h1>
            Healthy poultry,
            <br />
            clearer decisions.
          </h1>

          <p>
            Monitor poultry production status, review detections and stay
            informed with one simple platform.
          </p>
        </div>
      </div>

      <main className="auth-form-panel">
        <div className="auth-card">
          <div className="auth-heading">
            <span>Welcome back</span>
            <h1>Sign in to HenSense</h1>
            <p>Enter your account details to continue.</p>
          </div>

          <form noValidate onSubmit={handleSubmit} className="auth-form">
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                autoComplete="email"
                required
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                required
              />
            </label>

            <Link className="auth-recovery-link" to="/forgot-password">Forgot Password?</Link>

            {error && <div className="auth-error">{error}</div>}

            <button
              type="submit"
              className="auth-primary-button"
              disabled={submitting}
            >
              {submitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <div className="auth-footer">
            Don't have an account? <Link to="/register">Create account</Link>
          </div>
        </div>
      </main>
    </div>
  )
}