import { userMessage } from '../lib/userMessages';
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { createWebRecovery, recoveryError, recoverySuccess } from '../lib/passwordRecovery'
import henIcon from '../assets/brand/hensense-logo.png'
import './Auth.css'
const recovery = createWebRecovery(supabase.auth)
export default function PasswordRecovery({ reset = false }: { reset?: boolean }) {
  const [email,setEmail]=useState(''), [password,setPassword]=useState(''), [confirm,setConfirm]=useState('')
  const [busy,setBusy]=useState(false), [ready,setReady]=useState(false), [error,setError]=useState(''), [success,setSuccess]=useState('')
  const lock=useRef(false)
  useEffect(()=>{
    if(!reset)return
    let active=true
    const unsubscribe=recovery.subscribe(valid=>{if(active){setReady(valid);setError(valid?'':'This reset link is invalid or expired. Please request a new email.')}})
    void recovery.ready().then(valid=>{if(active){setReady(valid);if(!valid)setError('This reset link is invalid or expired. Please request a new email.')}})
    return()=>{active=false;unsubscribe()}
  },[reset])
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(lock.current)return
    if(!reset && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())){setError('Enter a valid email address.');return}
    if(reset && password.length<8){setError('Password must have at least 8 characters.');return}
    if(reset && password!==confirm){setError('Passwords do not match.');return}
    lock.current=true;setBusy(true);setError('');setSuccess('')
    try {
      if(reset){await recovery.update(password);setReady(false);setSuccess('Password updated. Sign in with your new password.')}
      else {
        const {error:sendError}=await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo:`${window.location.origin}/reset-password`})
        if(sendError){setError(recoveryError(sendError));return}
        setSuccess(recoverySuccess)
      }
    }catch(error){setError(reset?userMessage(error,'Unable to update password. Check the link and password requirements, then try again.'):recoveryError(null))}
    finally{lock.current=false;setBusy(false)}
  }
  return <div className="auth-page">
    <div className="auth-brand-panel"><div className="auth-brand"><div className="auth-brand-logo-frame"><span className="auth-brand-wordmark" aria-label="HenSense"><img src={henIcon} className="auth-brand-wordmark-icon" alt=""/><span className="auth-brand-wordmark-name"><span>Hen</span><span>Sense</span></span></span></div></div><div className="auth-brand-content"><span className="auth-eyebrow">SMART POULTRY MONITORING</span><h1>Healthy poultry,<br/>clearer decisions.</h1></div></div>
    <main className="auth-form-panel"><div className="auth-card"><div className="auth-heading"><h1>{reset?'Set new password':'Forgot password?'}</h1><p>{reset?'Choose a new password with at least 8 characters.':'Enter your email to request a password reset link.'}</p></div>
    <form noValidate className="auth-form" onSubmit={submit}>
      {reset?<><label>New password<input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e=>setPassword(e.target.value)} disabled={!ready||busy}/></label><label>Confirm password<input type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={e=>setConfirm(e.target.value)} disabled={!ready||busy}/></label></>:<label>Email<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>}
      {error&&<div className="auth-error" role="alert">{error}</div>}{success&&<div className="auth-success" role="status">{success}</div>}
      <button className="auth-primary-button" disabled={busy||(reset&&!ready)}>{busy?'Please wait...':reset?'Update password':'Send reset email'}</button>
    </form><div className="auth-footer"><Link to="/login">Back to sign in</Link>{reset&&<> · <Link to="/forgot-password">Request a new link</Link></>}</div></div></main>
  </div>
}
