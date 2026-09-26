// UI boundary: known English messages only. Codes/status remain available on errors.
const localMessages = new Set([
 "Choose an image smaller than 10 MB.",
 "Choose a JPEG or PNG photo. HEIC is not supported; use a compatible exported image.",
 "Camera permission was denied. You can enable it in Settings.",
 "Photo library permission was denied. You can enable it in Settings.",
 "Network unavailable. Check History or retry the same photo safely.",
 "Upload stalled. Check your connection, then check History or retry the same photo safely.",
 "Analysis timed out. It may still complete. Check History or retry the same photo safely.",
 "Upload interrupted. Check History before starting another detection.",
 "Connection timed out. Check your connection and retry the same photo safely.",
 "Session changed. Sign in again.",
 "Please sign in again.",
 "Your account changed; sign in again.",
 "Please choose a photo smaller than 2 MB.",
 "Choose a JPG, PNG or WebP photo.",
 "Invalid image data. Choose another photo.",
 "No photo was selected.",
 "Photo data was not returned. Please select it again.",
 "This password reset link is invalid or expired. Please request a new email.",
 "This reset link is invalid or expired. Please request a new email.",
 "Open a valid password reset link and wait for verification before submitting.",
 "Password updated, but sign out failed. Please sign out before signing in again.",
 "Password updated. Please sign out before signing in again."
]);
const messages: Record<string,string> = {
 ERR_MISSING_PERMISSION: 'Photo access was denied. Allow access in Settings and try again.',
 invalid_credentials: 'Incorrect email or password. Please try again.',
 email_not_confirmed: 'Please confirm your email before signing in.',
 weak_password: 'Choose a stronger password with at least 8 characters.',
 same_password: 'Choose a password different from your current password.',
 over_email_send_rate_limit: 'Too many email requests. Please wait before trying again.',
 over_request_rate_limit: 'Too many requests. Please wait and try again.',
 otp_expired: 'This reset link is invalid or expired. Please request a new email.',
 session_not_found: 'Your session has expired. Please sign in again.',
 refresh_token_not_found: 'Your session has expired. Please sign in again.',
 UNAUTHORIZED: 'Your session has expired. Please sign in again.',
 FORBIDDEN: 'You do not have permission to do this.',
 DELETE_BUSY: 'This photo is still being analyzed. Please wait before deleting it.',
 DELETE_FAILED: 'Unable to delete this record. Please try again.',
 DELETE_CLEANUP_PENDING: 'Deletion is not yet complete. Please retry deleting this record.',
 DELETE_UNSAFE_MEDIA: 'Unable to delete this record safely. Please contact support.',
};
export function userMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
 const e = (error && typeof error === 'object' ? error : {}) as {code?:string;status?:number;message?:string;name?:string};
 if(e.code || e.status) console.warn('HenSense request error', {code:e.code,status:e.status});
 if(e.code && Object.hasOwn(messages,e.code)) return messages[e.code];
 if(e.status === 429) return 'Too many requests. Please wait and try again.';
 if(e.status === 401) return messages.UNAUTHORIZED;
 if(e.status === 403) return messages.FORBIDDEN;
 if(e.status === 404) return 'This record is no longer available. Please refresh.';
 if(e.status === 413) return 'This image is too large. Please choose a smaller photo.';
 if(e.status === 415) return 'Choose a JPEG or PNG photo.';
 if(e.status === 422) return 'Check your input. For photos, use a valid JPEG or PNG up to 24 megapixels.';
 if(e.status === 409) return 'This request conflicts with an earlier action. Refresh and try again.';
 if(e.status && e.status >= 500) return 'The service is temporarily unavailable. Please try again shortly.';
 if(e.message && localMessages.has(e.message)) return e.message;
 if(e.name === 'AbortError' || e.name === 'TimeoutError' || /timed? out|timeout/i.test(e.message || '')) return 'The request timed out. Check your connection and try again.';
 if(/network|failed to fetch|fetch failed|offline/i.test(e.message || '')) return 'Unable to connect. Check your internet connection and try again.';
 return fallback;
}
export function serviceError(status: number, code?: string): Error & {status:number;code?:string} {
 return Object.assign(new Error('Service request failed'), {status,code});
}
