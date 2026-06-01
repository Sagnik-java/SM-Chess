import React, { useState, useEffect, useCallback } from 'react';
import { Chess, Move } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { Settings, RefreshCw, Undo, Users, LogIn, LogOut } from 'lucide-react';
import { getBestMove, evaluateBoard } from './ai';
import { SoundEffects } from './sounds';
import confetti from 'canvas-confetti';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, loginWithGoogle, logout, db } from './firebase';
import { collection, addDoc, doc, updateDoc, onSnapshot, query, where, getDocs, serverTimestamp, getDoc } from 'firebase/firestore';

const themes = {
  classic: { dark: '#b58863', light: '#f0d9b5', name: 'Classic Wood' },
  ocean: { dark: '#5c8bb0', light: '#e0eef6', name: 'Deep Ocean' },
  forest: { dark: '#769656', light: '#eeeed2', name: 'Lush Forest' },
  minimal: { dark: '#a0a0a0', light: '#fcfcfc', name: 'Minimalist' },
  midnight: { dark: '#3b3b3b', light: '#d3d3d3', name: 'Midnight' },
};

export default function App() {
  const [game, setGame] = useState(new Chess());
  const [playerColor, setPlayerColor] = useState<'w' | 'b'>('w');
  const [isAdaptive, setIsAdaptive] = useState(() => {
    return localStorage.getItem('sm-chess-adaptive') === 'true';
  });
  const [difficulty, setDifficulty] = useState(() => {
    const saved = localStorage.getItem('sm-chess-difficulty');
    return saved ? parseInt(saved, 10) : 2; // 1 = Easy, 2 = Medium, 3 = Hard, 4 = Expert
  });

  const activeDifficulty = React.useMemo(() => {
    if (!isAdaptive) return difficulty;
    const score = evaluateBoard(game);
    // Positive evaluation means White is ahead. Negative means Black is ahead.
    const playerAdvantage = playerColor === 'w' ? score : -score;
    // Adapt difficulty dynamically based on player performance:
    // - If player is strongly leading (> 3.0 pawns value / 300 score), AI plays at Expert (Level 4)
    // - If player is moderately leading (> 1.2 pawns / 120 score), AI plays at Hard (Level 3)
    // - If player is losing badly (< -1.2 pawns / -120 score), AI scales down to Easy (Level 1)
    // - Otherwise, AI plays at Normal/Medium (Level 2)
    if (playerAdvantage > 300) {
      return 4;
    } else if (playerAdvantage > 120) {
      return 3;
    } else if (playerAdvantage < -120) {
      return 1;
    } else {
      return 2;
    }
  }, [isAdaptive, difficulty, game, playerColor]);
  const [themeId, setThemeId] = useState<keyof typeof themes>('minimal');
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [gameOverMsg, setGameOverMsg] = useState<string | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [onlineGameId, setOnlineGameId] = useState<string | null>(null);
  const [isOnlineMode, setIsOnlineMode] = useState(false);
  const [opponentName, setOpponentName] = useState<string | null>(null);
  const [availableGames, setAvailableGames] = useState<any[]>([]);
  const [isLobbyOpen, setIsLobbyOpen] = useState(false);
  const [whiteTime, setWhiteTime] = useState(600);
  const [blackTime, setBlackTime] = useState(600);
  const [isSoundEnabled, setIsSoundEnabled] = useState(() => {
    return localStorage.getItem('sm-chess-sound') !== 'false';
  });

  const capturedPieces = React.useMemo(() => {
    const starting = { p: 8, n: 2, b: 2, r: 2, q: 1 };
    const pieces = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
    game.board().forEach(row => {
      row.forEach(piece => {
        if (piece && piece.type !== 'k') {
          pieces[piece.color as 'w'|'b'][piece.type as keyof typeof starting]++;
        }
      });
    });

    const getCaptured = (color: 'w' | 'b') => {
      const opp = color === 'w' ? 'b' : 'w';
      const caps: string[] = [];
      const symbols = color === 'w' ? { q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' } : { q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' };
      
      (['q', 'r', 'b', 'n', 'p'] as const).forEach(type => {
        const count = Math.max(0, starting[type] - pieces[opp][type]);
        for (let i = 0; i < count; i++) {
          caps.push(symbols[type]);
        }
      });
      return caps;
    };

    return { w: getCaptured('w'), b: getCaptured('b') };
  }, [game.fen()]);

  const engineEval = React.useMemo(() => {
    if (game.isGameOver()) return null;
    const score = evaluateBoard(game);
    const pawns = score / 100;
    return pawns > 0 ? `+${pawns.toFixed(1)}` : pawns.toFixed(1);
  }, [game.fen()]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => setUser(u));
    return unsub;
  }, []);

  useEffect(() => {
    if (!user || !isLobbyOpen) return;
    const q = query(collection(db, 'games'), where('status', '==', 'waiting'));
    const unsub = onSnapshot(q, snap => {
      setAvailableGames(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [user, isLobbyOpen]);

  useEffect(() => {
    if (!onlineGameId) return;
    const unsub = onSnapshot(doc(db, 'games', onlineGameId), snap => {
      const data = snap.data();
      if (data) {
        if (data.whiteTime !== undefined) setWhiteTime(data.whiteTime);
        if (data.blackTime !== undefined) setBlackTime(data.blackTime);

        if (data.fen !== game.fen()) {
          const newGame = new Chess(data.fen);
          setGame(newGame);
        }
        if (data.status === 'playing' && data.blackPlayerId && !opponentName) {
           setOpponentName(data.whitePlayerId === user?.uid ? data.blackPlayerName : data.whitePlayerName);
        }
      }
    });
    return unsub;
  }, [onlineGameId, game.fen(), user]);

  useEffect(() => {
    if (!isOnlineMode || !opponentName || opponentName === 'Waiting for opponent...' || game.isGameOver()) return;
    
    const interval = setInterval(() => {
      if (game.turn() === 'w') {
        setWhiteTime((prev) => Math.max(0, prev - 1));
      } else {
        setBlackTime((prev) => Math.max(0, prev - 1));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isOnlineMode, opponentName, game]);

  const handleCheckmateVisuals = (movedGame: Chess, move: Move) => {
    if (movedGame.isCheckmate()) {
      if (isSoundEnabled) SoundEffects.playCheckmate();
      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.5 },
        zIndex: 1000,
        disableForReducedMotion: true
      });
    } else if (move.captured) {
      if (isSoundEnabled) SoundEffects.playCapture();
    } else {
      if (isSoundEnabled) SoundEffects.playMove();
    }
  };

  const makeAIMove = useCallback(() => {
    setIsThinking(true);
    // Use timeout to allow UI update before blocking thread
    setTimeout(() => {
      if (game.isGameOver() || game.turn() === playerColor) {
        setIsThinking(false);
        return;
      }
      
      const bestMove = getBestMove(game.fen(), activeDifficulty);
      if (bestMove) {
        const newGame = new Chess(game.fen());
        const moveRes = newGame.move(bestMove);
        setGame(newGame);
        if (moveRes) handleCheckmateVisuals(newGame, moveRes);
      }
      setIsThinking(false);
    }, 100);
  }, [game, activeDifficulty, playerColor]);

  useEffect(() => {
    if (game.isGameOver()) {
      if (game.isCheckmate()) setGameOverMsg(`Checkmate! ${game.turn() === 'w' ? 'Black' : 'White'} wins.`);
      else if (game.isDraw()) setGameOverMsg('Draw!');
      else if (game.isStalemate()) setGameOverMsg('Stalemate!');
      else setGameOverMsg('Game Over!');
    } else if (isOnlineMode && whiteTime === 0) {
      setGameOverMsg('Black wins on time!');
    } else if (isOnlineMode && blackTime === 0) {
      setGameOverMsg('White wins on time!');
    } else {
      setGameOverMsg(null);
      if (!isOnlineMode && game.turn() !== playerColor) {
        makeAIMove();
      }
    }
  }, [game, playerColor, makeAIMove, isOnlineMode, whiteTime, blackTime]);

  const handleCreateOnlineGame = async () => {
    if (!user) return;
    const newGame = new Chess();
    const docRef = await addDoc(collection(db, 'games'), {
      status: 'waiting',
      fen: newGame.fen(),
      turn: 'w',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      whitePlayerId: user.uid,
      whitePlayerName: user.displayName || 'Player',
      blackPlayerId: null,
      blackPlayerName: null,
      winner: null,
      whiteTime: 600,
      blackTime: 600
    });
    setWhiteTime(600);
    setBlackTime(600);
    setOnlineGameId(docRef.id);
    setIsOnlineMode(true);
    setPlayerColor('w');
    setIsLobbyOpen(false);
    setGame(newGame);
    setOpponentName('Waiting for opponent...');
  };

  const handleJoinOnlineGame = async (gameId: string) => {
    if (!user) return;
    await updateDoc(doc(db, 'games', gameId), {
      status: 'playing',
      blackPlayerId: user.uid,
      blackPlayerName: user.displayName || 'Player',
      updatedAt: serverTimestamp(),
    });
    setOnlineGameId(gameId);
    setIsOnlineMode(true);
    setPlayerColor('b');
    setIsLobbyOpen(false);
    setGame(new Chess()); // syncs from snapshot
  };

  const onDrop = ({ sourceSquare, targetSquare }: any) => {
    if (!targetSquare) return false;
    if (game.turn() !== playerColor || isThinking) return false;
    if (isOnlineMode && opponentName === 'Waiting for opponent...') return false;
    if (isOnlineMode && (whiteTime === 0 || blackTime === 0)) return false;

    
    try {
      const newGame = new Chess(game.fen());
      const move = newGame.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: 'q',
      });
      
      if (move === null) return false;
      setGame(newGame);
      handleCheckmateVisuals(newGame, move);

      if (isOnlineMode && onlineGameId) {
        // Compute new times based on local state before writing
        const newWhiteTime = game.turn() === 'w' ? Math.max(0, whiteTime - 1) : whiteTime;
        const newBlackTime = game.turn() === 'b' ? Math.max(0, blackTime - 1) : blackTime;
        updateDoc(doc(db, 'games', onlineGameId), {
          fen: newGame.fen(),
          turn: newGame.turn(),
          updatedAt: serverTimestamp(),
          status: newGame.isGameOver() ? 'finished' : 'playing',
          winner: newGame.isGameOver() ? playerColor : null,
          whiteTime: newWhiteTime,
          blackTime: newBlackTime
        });
      }

      return true;
    } catch {
      return false;
    }
  };

  function resetGame() {
    setGame(new Chess());
    setGameOverMsg(null);
    setIsThinking(false);
    setIsOnlineMode(false);
    setOnlineGameId(null);
    setOpponentName(null);
    setWhiteTime(600);
    setBlackTime(600);
  }

  function undoMove() {
    if (isThinking) return;
    const newGame = new Chess(game.fen());
    newGame.undo(); // Undo AI move
    newGame.undo(); // Undo Player move
    setGame(newGame);
  }

  return (
    <div className={`min-h-screen transition-colors duration-300 flex flex-col font-['Helvetica_Neue',Arial,sans-serif] ${isDarkMode ? 'bg-[#0f1115] text-[#e2e8f0]' : 'bg-zinc-50 text-zinc-900'}`}>
      <header className={`h-[64px] flex items-center justify-between px-6 sm:px-10 w-full shrink-0 border-b ${isDarkMode ? 'border-[#1e293b]' : 'border-zinc-200'}`}>
        <div className="flex items-center gap-3">
          <div className={`w-[32px] h-[32px] rounded-[6px] flex items-center justify-center ${isDarkMode ? 'bg-[#60a5fa] text-[#0f1115]' : 'bg-blue-600 text-white'}`}>
            <span className="font-bold text-sm">SM</span>
          </div>
          <h1 className="text-[20px] font-medium tracking-tight">SM Chess</h1>
        </div>
        <div className="flex items-center gap-4">
          <button 
             onClick={() => {
               if (user) { setIsLobbyOpen(true); } else { loginWithGoogle(); }
             }}
             className={`hidden sm:flex items-center gap-2 px-[12px] py-[6px] rounded-full text-[12px] font-semibold transition-colors ${isDarkMode ? 'bg-[#1e293b] hover:bg-[#334155] text-[#e2e8f0]' : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-800'}`}>
            <Users size={14} /> {user ? 'Lobby' : 'Sign In To Play Online'}
          </button>
          <div className={`hidden sm:inline-flex items-center px-[12px] py-[4px] rounded-full text-[12px] font-semibold ${isDarkMode ? 'bg-[#1e293b] text-[#60a5fa]' : 'bg-blue-100 text-blue-700'}`}>
            <span className={`w-[8px] h-[8px] rounded-full mr-2 ${isDarkMode ? 'bg-[#60a5fa]' : 'bg-blue-600'}`}></span>
            {game.isGameOver() ? 'Game Over' : isThinking ? `AI Thinking (Level ${activeDifficulty})` : isOnlineMode ? 'Online Match' : 'Your Turn'}
          </div>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className={`p-2 rounded-full transition-colors ${
              isDarkMode ? 'hover:bg-[#1e293b] text-[#e2e8f0]' : 'hover:bg-zinc-200 text-zinc-700'
            }`}
            aria-label="Settings"
          >
            <Settings size={20} />
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row w-full max-w-[1024px] mx-auto p-[20px] lg:p-[40px] gap-[40px]">
        <div className="flex-1 w-full max-w-[480px] mx-auto flex items-center justify-center">
          <div className={`w-full p-[8px] rounded-[4px] shadow-[0_20px_25px_-5px_rgba(0,0,0,0.3)] transition-all ${isDarkMode ? 'bg-[#1e293b]' : 'bg-white border border-zinc-200'}`}>
            <Chessboard
              options={{
                position: game.fen(),
                onPieceDrop: onDrop,
                boardOrientation: playerColor === 'w' ? 'white' : 'black',
                darkSquareStyle: { backgroundColor: themes[themeId].dark },
                lightSquareStyle: { backgroundColor: themes[themeId].light },
                animationDurationInMs: 200,
              }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-[24px] w-full lg:w-[320px]">
          <div className={`flex flex-col rounded-[8px] p-[20px] border ${isDarkMode ? 'bg-[#1a1d23] border-[#2d3748]' : 'bg-white border-zinc-200'}`}>
            <span className={`text-[11px] uppercase tracking-[0.1em] mb-[12px] block ${isDarkMode ? 'text-[#94a3b8]' : 'text-zinc-500'}`}>Game Status</span>
            
            {gameOverMsg ? (
              <div className={`p-3 rounded-md text-sm font-medium text-center ${isDarkMode ? 'bg-red-900/40 text-red-300' : 'bg-red-100 text-red-700'}`}>
                {gameOverMsg}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Turn</span>
                  <span className={`text-[12px] px-2 py-1 rounded font-semibold ${isDarkMode ? 'bg-[#334155] text-white' : 'bg-zinc-100 text-zinc-800'}`}>
                     {game.turn() === 'w' ? 'White' : 'Black'}
                  </span>
                </div>
                {isOnlineMode && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Opponent</span>
                      <span className={`text-[12px] px-2 py-1 rounded font-semibold ${isDarkMode ? 'bg-[#334155] text-[#e2e8f0]' : 'bg-zinc-100 text-zinc-800'}`}>
                        {opponentName || 'Waiting...'}
                      </span>
                    </div>
                    <div className={`mt-2 pt-3 border-t flex items-center justify-between gap-2 ${isDarkMode ? 'border-[#2d3748]' : 'border-zinc-200'}`}>
                      <div className={`flex flex-col items-center justify-center flex-1 rounded px-2 py-1.5 ${isDarkMode ? 'bg-[#1e293b]' : 'bg-zinc-100'}`}>
                        <span className={`text-[10px] tracking-wider uppercase mb-0.5 ${isDarkMode ? 'text-[#94a3b8]' : 'text-zinc-500'}`}>White Time</span>
                        <span className={`font-mono text-lg font-semibold ${game.turn() === 'w' ? (isDarkMode ? 'text-[#60a5fa]' : 'text-blue-600') : (isDarkMode ? 'text-[#e2e8f0]' : 'text-zinc-800')}`}>{formatTime(whiteTime)}</span>
                      </div>
                      <div className={`flex flex-col items-center justify-center flex-1 rounded px-2 py-1.5 ${isDarkMode ? 'bg-[#1e293b]' : 'bg-zinc-100'}`}>
                        <span className={`text-[10px] tracking-wider uppercase mb-0.5 ${isDarkMode ? 'text-[#94a3b8]' : 'text-zinc-500'}`}>Black Time</span>
                        <span className={`font-mono text-lg font-semibold ${game.turn() === 'b' ? (isDarkMode ? 'text-[#60a5fa]' : 'text-blue-600') : (isDarkMode ? 'text-[#e2e8f0]' : 'text-zinc-800')}`}>{formatTime(blackTime)}</span>
                      </div>
                    </div>
                  </>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">State</span>
                  <span className={`text-sm ${isDarkMode ? 'text-[#94a3b8]' : 'text-zinc-500'}`}>
                    {game.inCheck() ? 'Check!' : isThinking ? 'AI is thinking...' : isOnlineMode ? (game.turn() === playerColor ? 'Your move' : "Opponent's move") : 'Your move'}
                  </span>
                </div>
                {engineEval !== null && (
                  <div className={`mt-2 pt-3 border-t flex items-center justify-between ${isDarkMode ? 'border-[#2d3748]' : 'border-zinc-200'}`}>
                    <span className="text-sm font-medium">Engine Eval</span>
                    <span className={`font-mono text-sm font-semibold ${isDarkMode ? (parseFloat(engineEval) > 0 ? 'text-[#60a5fa]' : parseFloat(engineEval) < 0 ? 'text-white' : 'text-[#94a3b8]') : (parseFloat(engineEval) > 0 ? 'text-blue-600' : parseFloat(engineEval) < 0 ? 'text-black' : 'text-zinc-500')}`}>
                      {engineEval}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className={`mt-4 pt-4 border-t ${isDarkMode ? 'border-[#2d3748]' : 'border-zinc-200'}`}>
              <span className={`text-[11px] uppercase tracking-[0.1em] mb-3 block ${isDarkMode ? 'text-[#94a3b8]' : 'text-zinc-500'}`}>Material Status</span>
              <div className="flex flex-col gap-2">
                <div className={`flex items-center justify-between p-2 rounded ${isDarkMode ? 'bg-[#1e293b]' : 'bg-zinc-100'}`}>
                  <span className={`text-xs font-medium ${isDarkMode ? 'text-[#94a3b8]' : 'text-zinc-600'}`}>White Captured</span>
                  <span className={`text-lg tracking-widest ${isDarkMode ? 'text-[#e2e8f0]' : 'text-zinc-800'}`}>
                    {capturedPieces.w.length > 0 ? capturedPieces.w.join('') : <span className="text-[10px] opacity-50 uppercase tracking-wider font-sans">None</span>}
                  </span>
                </div>
                <div className={`flex items-center justify-between p-2 rounded ${isDarkMode ? 'bg-[#1e293b]' : 'bg-zinc-100'}`}>
                  <span className={`text-xs font-medium ${isDarkMode ? 'text-[#94a3b8]' : 'text-zinc-600'}`}>Black Captured</span>
                  <span className={`text-lg tracking-widest ${isDarkMode ? 'text-white' : 'text-black'}`}>
                    {capturedPieces.b.length > 0 ? capturedPieces.b.join('') : <span className="text-[10px] opacity-50 uppercase tracking-wider font-sans">None</span>}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 mt-6">
              <button
                onClick={undoMove}
                disabled={isThinking || game.history().length === 0}
                className={`flex items-center justify-center gap-2 py-2 px-4 rounded-[4px] text-[14px] font-medium transition-colors disabled:opacity-50 border
                  ${isDarkMode ? 'bg-[#1e293b] border-[#2d3748] hover:bg-[#334155] text-[#e2e8f0]' : 'bg-zinc-100 border-zinc-200 hover:bg-zinc-200 text-zinc-900'}`}
              >
                <Undo size={16} /> Undo Move
              </button>
              <button
                onClick={resetGame}
                className={`flex items-center justify-center gap-2 py-2 px-4 rounded-[4px] text-[14px] font-medium transition-colors
                  ${isDarkMode ? 'bg-[#60a5fa] hover:bg-blue-500 text-[#0f1115]' : 'bg-zinc-900 hover:bg-zinc-800 text-white'}`}
              >
                <RefreshCw size={16} /> New Game
              </button>
            </div>
          </div>

          <div className={`flex flex-col flex-1 rounded-[8px] p-[20px] border ${isDarkMode ? 'bg-[#1a1d23] border-[#2d3748]' : 'bg-white border-zinc-200'}`}>
            <span className={`text-[11px] uppercase tracking-[0.1em] mb-[12px] block ${isDarkMode ? 'text-[#94a3b8]' : 'text-zinc-500'}`}>Match Details</span>
            <div className={`mb-4 pb-4 border-b ${isDarkMode ? 'border-[#2d3748]' : 'border-zinc-200'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-[11px] uppercase tracking-[0.1em] ${isDarkMode ? 'text-[#94a3b8]' : 'text-zinc-500'}`}>AI Difficulty</span>
                <span className={`text-[11px] px-2 py-0.5 rounded font-semibold transition-all ${
                  isAdaptive 
                    ? (isDarkMode ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-emerald-50 text-emerald-700 border border-emerald-100') 
                    : (isDarkMode ? 'bg-[#1e293b] text-blue-400 border border-[#2d3748]' : 'bg-zinc-100 text-blue-700 border border-zinc-200')
                }`}>
                  {isAdaptive ? `Adaptive: Lvl ${activeDifficulty}` : `Level ${difficulty}`}
                </span>
              </div>
              
              <div className="relative mt-2.5 mb-4">
                <input
                  type="range"
                  min="1"
                  max="4"
                  step="1"
                  value={isAdaptive ? activeDifficulty : difficulty}
                  disabled={isAdaptive}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    setDifficulty(val);
                    localStorage.setItem('sm-chess-difficulty', val.toString());
                  }}
                  className={`w-full h-1 rounded-lg appearance-none cursor-pointer transition-opacity ${
                    isAdaptive 
                      ? 'opacity-50 cursor-not-allowed bg-emerald-500/20' 
                      : (isDarkMode ? 'bg-[#2d3748]' : 'bg-[#e4e4e7]')
                  } accent-blue-500`}
                  style={{
                    background: !isAdaptive 
                      ? `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${(difficulty - 1) / 3 * 100}%, ${isDarkMode ? '#2d3748' : '#e4e4e7'} ${(difficulty - 1) / 3 * 100}%, ${isDarkMode ? '#2d3748' : '#e4e4e7'} 100%)`
                      : `linear-gradient(to right, #10b981 0%, #10b981 ${(activeDifficulty - 1) / 3 * 100}%, ${isDarkMode ? '#1e293b' : '#f4f4f5'} ${(activeDifficulty - 1) / 3 * 100}%, ${isDarkMode ? '#1e293b' : '#f4f4f5'} 100%)`
                  }}
                />
                <div className="flex justify-between text-[9px] font-mono mt-1 px-0.5">
                  <span className={`${(isAdaptive ? activeDifficulty === 1 : difficulty === 1) ? (isAdaptive ? 'font-bold text-emerald-400' : 'font-bold text-blue-400') : 'text-zinc-500'}`}>Lvl 1</span>
                  <span className={`${(isAdaptive ? activeDifficulty === 2 : difficulty === 2) ? (isAdaptive ? 'font-bold text-emerald-400' : 'font-bold text-blue-400') : 'text-zinc-500'}`}>Lvl 2</span>
                  <span className={`${(isAdaptive ? activeDifficulty === 3 : difficulty === 3) ? (isAdaptive ? 'font-bold text-emerald-400' : 'font-bold text-blue-400') : 'text-zinc-500'}`}>Lvl 3</span>
                  <span className={`${(isAdaptive ? activeDifficulty === 4 : difficulty === 4) ? (isAdaptive ? 'font-bold text-emerald-400' : 'font-bold text-blue-400') : 'text-zinc-500'}`}>Lvl 4</span>
                </div>
              </div>

              <button
                onClick={() => {
                  const val = !isAdaptive;
                  setIsAdaptive(val);
                  localStorage.setItem('sm-chess-adaptive', val.toString());
                }}
                className={`w-full flex items-center justify-between p-2 rounded text-left transition-all border ${
                  isAdaptive 
                    ? (isDarkMode ? 'bg-emerald-950/20 border-emerald-500/30' : 'bg-emerald-50 border-emerald-200') 
                    : (isDarkMode ? 'bg-[#1e293b]/50 border-[#2d3748] hover:border-[#475569]' : 'bg-zinc-50/50 border-zinc-200 hover:border-zinc-300')
                }`}
              >
                <div>
                  <div className="text-xs font-semibold flex items-center gap-1.5">
                    {isAdaptive ? (
                      <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    ) : (
                      <span className="flex h-1.5 w-1.5 rounded-full bg-zinc-400"></span>
                    )}
                    Adaptive Difficulty
                  </div>
                  <div className={`text-[10px] mt-0.5 ${isDarkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
                    AI auto-adjusts strength to match your level
                  </div>
                </div>
                <div className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isAdaptive ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700'}`}>
                  <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isAdaptive ? 'translate-x-3' : 'translate-x-0'}`} />
                </div>
              </button>
            </div>
            <div className="flex justify-between mb-3 text-sm">
              <span className={isDarkMode ? 'text-[#94a3b8]' : 'text-zinc-500'}>Theme</span>
              <span>{themes[themeId].name}</span>
            </div>
            <div className={`flex justify-between mb-4 pb-4 border-b text-sm ${isDarkMode ? 'border-[#2d3748]' : 'border-zinc-200'}`}>
              <span className={isDarkMode ? 'text-[#94a3b8]' : 'text-zinc-500'}>Playing As</span>
              <span>{playerColor === 'w' ? 'White' : 'Black'}</span>
            </div>
            
            <div className="flex-1 flex flex-col min-h-0 mb-4">
              <span className={`text-[11px] uppercase tracking-[0.1em] mb-[8px] block ${isDarkMode ? 'text-[#94a3b8]' : 'text-zinc-500'}`}>Move History</span>
              <div className={`flex-1 overflow-y-auto max-h-[180px] pr-2 ${isDarkMode ? '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#334155] [&::-webkit-scrollbar-track]:bg-transparent' : '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-zinc-200 [&::-webkit-scrollbar-track]:bg-transparent'}`}>
                {game.history().length === 0 ? (
                  <div className={`text-sm italic py-2 text-center ${isDarkMode ? 'text-[#64748b]' : 'text-zinc-400'}`}>No moves yet</div>
                ) : (
                  <table className="w-full text-sm text-left">
                    <thead className={`sticky top-0 z-10 opacity-95 ${isDarkMode ? 'bg-[#1a1d23] text-[#64748b]' : 'bg-white text-zinc-400'}`}>
                      <tr>
                        <th className="py-1 w-10 font-normal">#</th>
                        <th className="py-1 font-normal">White</th>
                        <th className="py-1 font-normal">Black</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: Math.ceil(game.history().length / 2) }).map((_, i) => (
                        <tr key={i} className={`border-b border-dashed last:border-0 ${isDarkMode ? 'border-[#2d3748]' : 'border-zinc-100'}`}>
                          <td className={`py-1.5 ${isDarkMode ? 'text-[#64748b]' : 'text-zinc-400'}`}>{i + 1}.</td>
                          <td className={`py-1.5 font-medium ${isDarkMode ? 'text-[#e2e8f0]' : 'text-zinc-700'}`}>{game.history()[i * 2]}</td>
                          <td className={`py-1.5 font-medium ${isDarkMode ? 'text-[#e2e8f0]' : 'text-zinc-700'}`}>{game.history()[i * 2 + 1] || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className={`mt-auto pt-[16px] border-t text-[12px] flex justify-between items-center ${isDarkMode ? 'border-[#2d3748] text-[#64748b]' : 'border-zinc-200 text-zinc-500'}`}>
               <span>Version 2.4.0</span>
               <span className="font-medium text-[#94a3b8]">Created by Sagnik Manna</span>
            </div>
          </div>
        </div>
      </main>

      {isLobbyOpen && user && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#0f1115]/80 backdrop-blur-sm">
          <div className={`w-full max-w-md rounded-[8px] shadow-2xl overflow-hidden border ${isDarkMode ? 'bg-[#1a1d23] border-[#2d3748] text-[#e2e8f0]' : 'bg-white border-zinc-200 text-zinc-900'}`}>
            <div className={`p-5 flex justify-between items-center border-b ${isDarkMode ? 'border-[#2d3748]' : 'border-zinc-200'}`}>
              <h2 className="text-lg font-medium">Multiplayer Lobby</h2>
              <button onClick={() => setIsLobbyOpen(false)} className={`p-1.5 rounded-[4px] ${isDarkMode ? 'hover:bg-[#334155]' : 'hover:bg-zinc-100'}`}>
                ✕
              </button>
            </div>
            <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
              <div>
                <button
                  onClick={handleCreateOnlineGame}
                  className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-[4px] text-[15px] font-medium transition-colors ${isDarkMode ? 'bg-[#60a5fa] hover:bg-blue-500 text-[#0f1115]' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
                >
                  Create New Match
                </button>
              </div>
              <div className="space-y-3">
                <label className={`text-[11px] uppercase tracking-[0.1em] ${isDarkMode ? 'text-[#94a3b8]' : 'text-zinc-500'}`}>Available Matches</label>
                {availableGames.length === 0 ? (
                  <p className={`text-sm ${isDarkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>No waiting games found. Create one above!</p>
                ) : (
                  <div className="space-y-2">
                    {availableGames.map(g => (
                      <div key={g.id} className={`flex items-center justify-between p-3 rounded border ${isDarkMode ? 'border-[#2d3748] bg-[#1e293b]' : 'border-zinc-200 bg-zinc-50'}`}>
                        <div className="flex flex-col">
                          <span className="font-medium text-sm">{g.whitePlayerName}</span>
                          <span className={`text-xs ${isDarkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>Waiting for opponent</span>
                        </div>
                        <button
                          onClick={() => handleJoinOnlineGame(g.id)}
                          className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${isDarkMode ? 'bg-[#475569] hover:bg-[#334155] text-white' : 'bg-zinc-200 hover:bg-zinc-300 text-zinc-900'}`}
                        >
                          Join Match
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className={`p-4 border-t flex justify-between items-center ${isDarkMode ? 'border-[#2d3748]' : 'border-zinc-200'}`}>
              <div className="flex items-center gap-2">
                <img src={user.photoURL || ''} alt="" className="w-6 h-6 rounded-full" />
                <span className="text-sm font-medium">{user.displayName}</span>
              </div>
              <button 
                onClick={logout}
                className={`flex items-center gap-1 text-sm font-medium ${isDarkMode ? 'text-red-400 hover:text-red-300' : 'text-red-600 hover:text-red-700'}`}
              >
                <LogOut size={14} /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {isSettingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#0f1115]/80 backdrop-blur-sm">
          <div className={`w-full max-w-md rounded-[8px] shadow-2xl overflow-hidden border ${isDarkMode ? 'bg-[#1a1d23] border-[#2d3748] text-[#e2e8f0]' : 'bg-white border-zinc-200 text-zinc-900'}`}>
            <div className={`p-5 flex justify-between items-center border-b ${isDarkMode ? 'border-[#2d3748]' : 'border-zinc-200'}`}>
              <h2 className="text-lg font-medium">Settings</h2>
              <button onClick={() => setIsSettingsOpen(false)} className={`p-1.5 rounded-[4px] ${isDarkMode ? 'hover:bg-[#334155]' : 'hover:bg-zinc-100'}`}>
                ✕
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="space-y-3">
                <label className={`text-[11px] uppercase tracking-[0.1em] ${isDarkMode ? 'text-[#94a3b8]' : 'text-zinc-500'}`}>Appearance</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setIsDarkMode(false)}
                    className={`py-2 px-4 rounded-[4px] text-[14px] transition-colors border ${!isDarkMode ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-[#2d3748] bg-[#1e293b] text-[#e2e8f0] hover:bg-[#334155]'}`}
                  >
                    Light
                  </button>
                  <button
                    onClick={() => setIsDarkMode(true)}
                    className={`py-2 px-4 rounded-[4px] text-[14px] transition-colors border ${isDarkMode ? 'border-[#60a5fa] bg-[#1e293b] text-[#60a5fa]' : 'border-zinc-200 bg-white hover:bg-zinc-50'}`}
                  >
                    Dark
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <label className={`text-[11px] uppercase tracking-[0.1em] ${isDarkMode ? 'text-[#94a3b8]' : 'text-zinc-500'}`}>Audio</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => { setIsSoundEnabled(true); localStorage.setItem('sm-chess-sound', 'true'); }}
                    className={`py-2 px-4 rounded-[4px] text-[14px] transition-colors border ${isSoundEnabled ? (isDarkMode ? 'border-[#60a5fa] bg-[#1e293b] text-[#60a5fa]' : 'border-blue-500 bg-blue-50 text-blue-700') : (isDarkMode ? 'border-[#2d3748] bg-[#1e293b] text-[#e2e8f0] hover:bg-[#334155]' : 'border-zinc-200 bg-white hover:bg-zinc-50')}`}
                  >
                    On
                  </button>
                  <button
                    onClick={() => { setIsSoundEnabled(false); localStorage.setItem('sm-chess-sound', 'false'); }}
                    className={`py-2 px-4 rounded-[4px] text-[14px] transition-colors border ${!isSoundEnabled ? (isDarkMode ? 'border-[#60a5fa] bg-[#1e293b] text-[#60a5fa]' : 'border-blue-500 bg-blue-50 text-blue-700') : (isDarkMode ? 'border-[#2d3748] bg-[#1e293b] text-[#e2e8f0] hover:bg-[#334155]' : 'border-zinc-200 bg-white hover:bg-zinc-50')}`}
                  >
                    Off
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className={`text-[11px] uppercase tracking-[0.1em] ${isDarkMode ? 'text-[#94a3b8]' : 'text-zinc-500'}`}>Difficulty Mode</label>
                  <span className={`text-[11px] font-mono font-semibold ${isAdaptive ? 'text-emerald-500' : 'text-blue-500'}`}>
                    {isAdaptive ? `Adaptive (Lvl ${activeDifficulty})` : `Level ${difficulty}`}
                  </span>
                </div>
                
                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 3, 4].map((level) => (
                    <button
                      key={level}
                      disabled={isAdaptive}
                      onClick={() => {
                        setDifficulty(level);
                        localStorage.setItem('sm-chess-difficulty', level.toString());
                      }}
                      className={`py-2 text-[12px] sm:text-[13px] rounded-[4px] border transition-all ${
                        isAdaptive
                          ? (activeDifficulty === level ? (isDarkMode ? 'border-emerald-500/30 bg-emerald-[#115e59]/20 text-[#34d399]' : 'border-emerald-250 bg-emerald-50 text-emerald-700') : (isDarkMode ? 'border-transparent bg-[#1e293b]/30 text-zinc-650' : 'border-transparent bg-zinc-50 text-zinc-400'))
                          : (difficulty === level ? (isDarkMode ? 'border-[#60a5fa] bg-[#1e293b] text-[#60a5fa]' : 'border-blue-500 bg-blue-50 text-blue-700') : (isDarkMode ? 'border-[#2d3748] bg-[#1e293b] text-[#e2e8f0] hover:bg-[#334155]' : 'border-zinc-200 bg-white hover:bg-zinc-50'))
                      }`}
                    >
                      {level === 1 ? 'Easy' : level === 2 ? 'Medium' : level === 3 ? 'Hard' : 'Expert'}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => {
                    const val = !isAdaptive;
                    setIsAdaptive(val);
                    localStorage.setItem('sm-chess-adaptive', val.toString());
                  }}
                  className={`w-full flex items-center justify-between p-2.5 rounded border text-left transition-all ${
                    isAdaptive 
                      ? (isDarkMode ? 'bg-emerald-950/25 border-emerald-500/30 font-medium' : 'bg-emerald-50 border-emerald-200') 
                      : (isDarkMode ? 'bg-[#1e293b]/50 border-[#2d3748] hover:border-[#475569]' : 'bg-zinc-50/50 border-zinc-200 hover:border-zinc-300')
                  }`}
                >
                  <div>
                    <div className="text-xs font-semibold flex items-center gap-1.5">
                      {isAdaptive ? (
                        <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      ) : (
                        <span className="flex h-1.5 w-1.5 rounded-full bg-zinc-400"></span>
                      )}
                      Adaptive Difficulty
                    </div>
                    <div className={`text-[10px] mt-0.5 ${isDarkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
                      AI auto-adjusts strength to match your level
                    </div>
                  </div>
                  <div className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isAdaptive ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700'}`}>
                    <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isAdaptive ? 'translate-x-3' : 'translate-x-0'}`} />
                  </div>
                </button>
              </div>

              <div className="space-y-3">
                <label className={`text-[11px] uppercase tracking-[0.1em] ${isDarkMode ? 'text-[#94a3b8]' : 'text-zinc-500'}`}>Board Aesthetics</label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.entries(themes) as [keyof typeof themes, typeof themes[keyof typeof themes]][]).map(([key, theme]) => (
                    <button
                      key={key}
                      onClick={() => setThemeId(key)}
                      className={`py-2 px-3 text-[14px] flex items-center justify-between rounded-[4px] border transition-colors ${themeId === key ? (isDarkMode ? 'border-[#60a5fa] bg-[#1e293b] text-[#60a5fa]' : 'border-blue-500 bg-blue-50 text-blue-700') : (isDarkMode ? 'border-[#2d3748] bg-[#1e293b] text-[#e2e8f0] hover:bg-[#334155]' : 'border-zinc-200 bg-white hover:bg-zinc-50')}`}
                    >
                      {theme.name}
                      <span className={`flex w-6 h-6 rounded-[2px] border overflow-hidden ${isDarkMode ? 'border-transparent' : 'border-zinc-300'}`}>
                        <span className="flex-1 w-full h-full block" style={{ backgroundColor: theme.light }}></span>
                        <span className="flex-1 w-full h-full block" style={{ backgroundColor: theme.dark }}></span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <label className={`text-[11px] uppercase tracking-[0.1em] ${isDarkMode ? 'text-[#94a3b8]' : 'text-zinc-500'}`}>Play As</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => { setPlayerColor('w'); resetGame(); }}
                    className={`py-2 px-4 rounded-[4px] text-[14px] transition-colors border ${playerColor === 'w' ? (isDarkMode ? 'border-[#60a5fa] bg-[#1e293b] text-[#60a5fa]' : 'border-blue-500 bg-blue-50 text-blue-700') : (isDarkMode ? 'border-[#2d3748] bg-[#1e293b] text-[#e2e8f0] hover:bg-[#334155]' : 'border-zinc-200 bg-white hover:bg-zinc-50')}`}
                  >
                    White
                  </button>
                  <button
                    onClick={() => { setPlayerColor('b'); resetGame(); }}
                    className={`py-2 px-4 rounded-[4px] text-[14px] transition-colors border ${playerColor === 'b' ? (isDarkMode ? 'border-[#60a5fa] bg-[#1e293b] text-[#60a5fa]' : 'border-blue-500 bg-blue-50 text-blue-700') : (isDarkMode ? 'border-[#2d3748] bg-[#1e293b] text-[#e2e8f0] hover:bg-[#334155]' : 'border-zinc-200 bg-white hover:bg-zinc-50')}`}
                  >
                    Black
                  </button>
                </div>
              </div>
            </div>

            <div className={`p-4 text-center border-t text-[12px] ${isDarkMode ? 'border-[#2d3748] text-[#94a3b8]' : 'border-zinc-200 text-zinc-500'}`}>
              Created by Sagnik Manna
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
