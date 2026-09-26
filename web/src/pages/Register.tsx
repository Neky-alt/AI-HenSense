import { userMessage } from '../lib/userMessages';
import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import './Auth.css'
import henIcon from '../assets/brand/hensense-logo.png'

export default function Register() {
  const { signUp, user, loading: authLoading } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!authLoading && user) {
    return <Navigate to="/" replace />
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())){setError('Enter a valid email address.');return}
    if(!password){setError('Enter your password.');return}

    setError('')
    setMessage('')

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)

    try {
      await signUp(email.trim(), password)

      setMessage(
        'Account created successfully. Please check your email if confirmation is required, then sign in.'
      )

      setEmail('')
      setPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(
        userMessage(err, 'Unable to create account. Please try again.')
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
            Start monitoring
            <br />
            with confidence.
          </h1>

          <p>
            Create your account to access poultry monitoring, detection
            history and farm alerts.
          </p>
        </div>
      </div>

      <main className="auth-form-panel">
        <div className="auth-card">
          <div className="auth-heading">
            <span>Create your account</span>
            <h1>Join HenSense</h1>
            <p>Set up your account to get started.</p>
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
                placeholder="At least 6 characters"
                autoComplete="new-password"
                required
              />
            </label>

            <label>
              Confirm password
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(event.target.value)
                }
                placeholder="Enter password again"
                autoComplete="new-password"
                required
              />
            </label>

            {error && <div className="auth-error">{error}</div>}
            {message && <div className="auth-success">{message}</div>}

            <button
              type="submit"
              className="auth-primary-button"
              disabled={submitting}
            >
              {submitting ? 'Creating account...' : 'Create account'}
            </button>
          </form>

          <div className="auth-footer">
            Already have an account? <Link to="/login">Sign in</Link>
          </div>
        </div>
      </main>
    </div>
  )
}