import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './astrogram.css';
import './responsive.css';
import { installInteractionSounds } from './lib/sounds';

// One event listener for the entire SPA, even under React StrictMode.
installInteractionSounds();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
