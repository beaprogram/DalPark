import { initializeApp } from 'firebase/app';
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAJK5bzMRAS4JMUPpOLHkZfiO49BFPIJQk",
  authDomain: "dalparkaid.firebaseapp.com",
  projectId: "dalparkaid",
  storageBucket: "dalparkaid.firebasestorage.app",
  messagingSenderId: "484151922531",
  appId: "1:484151922531:web:8185205a269b1e95be8d56"
};

const app = initializeApp(firebaseConfig);

export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(ReactNativeAsyncStorage)
});

export const db = getFirestore(app);