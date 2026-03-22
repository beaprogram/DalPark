import { initializeApp } from 'firebase/app';
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyDrZZHzp8u4jdZn5k5xoJCvQqC9BXw7JlE",
  authDomain: "dalparking-19789.firebaseapp.com",
  projectId: "dalparking-19789",
  storageBucket: "dalparking-19789.firebasestorage.app",
  messagingSenderId: "267186162003",
  appId: "1:267186162003:web:1a5522a2e5e351104739a6"
};

const app = initializeApp(firebaseConfig);

export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(ReactNativeAsyncStorage)
});

export const db = getFirestore(app);
export const storage = getStorage(app);
