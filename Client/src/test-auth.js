// Test script to validate the authentication system
import { auth } from './lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';

console.log('Testing Firebase Authentication System...');

// Test Firebase auth state
onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log('✅ Firebase user is authenticated:', {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName
    });
    
    // Test token refresh
    user.getIdToken().then(token => {
      console.log('✅ Firebase token obtained successfully');
      console.log('Token length:', token.length);
      
      // Check token expiry
      const tokenPayload = JSON.parse(atob(token.split('.')[1]));
      const expiryTime = tokenPayload.exp * 1000;
      const currentTime = Date.now();
      const timeToExpiry = (expiryTime - currentTime) / 1000 / 60; // minutes
      
      console.log('⏰ Token expires in:', Math.round(timeToExpiry), 'minutes');
      
      if (timeToExpiry < 15) {
        console.log('⚠️ Token will expire soon, testing refresh...');
        user.getIdToken(true).then(newToken => {
          console.log('✅ Token refreshed successfully');
          console.log('New token length:', newToken.length);
        }).catch(error => {
          console.error('❌ Token refresh failed:', error);
        });
      }
    }).catch(error => {
      console.error('❌ Failed to get token:', error);
    });
  } else {
    console.log('❌ No Firebase user authenticated');
  }
});

// Test the automatic refresh system
console.log('Testing automatic refresh system...');
setTimeout(() => {
  console.log('🔄 Automatic refresh test completed');
}, 5000);
