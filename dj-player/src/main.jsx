import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { purgePrivateCaches } from './services/spotifyAPI.js';

// Versiones anteriores guardaban respuestas de la API de Spotify en el
// service worker; se eliminan para no dejar datos personales en disco.
purgePrivateCaches();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
