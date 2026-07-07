// src/App.js
import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import MainApp from './MainApp';
import KanjiPage from './KanjiPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainApp />} />
        <Route path="/kanji/:char" element={<KanjiPage />} />
      </Routes>
    </BrowserRouter>
  );
}