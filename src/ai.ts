import { Chess, Move } from 'chess.js';

const pieceValues: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

const pawnEvalWhite = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [50, 50, 50, 50, 50, 50, 50, 50],
  [10, 10, 20, 30, 30, 20, 10, 10],
  [5, 5, 10, 25, 25, 10, 5, 5],
  [0, 0, 0, 20, 20, 0, 0, 0],
  [5, -5, -10, 0, 0, -10, -5, 5],
  [5, 10, 10, -20, -20, 10, 10, 5],
  [0, 0, 0, 0, 0, 0, 0, 0],
];
const pawnEvalBlack = pawnEvalWhite.slice().reverse();

const knightEval = [
  [-50, -40, -30, -30, -30, -30, -40, -50],
  [-40, -20, 0, 0, 0, 0, -20, -40],
  [-30, 0, 10, 15, 15, 10, 0, -30],
  [-30, 5, 15, 20, 20, 15, 5, -30],
  [-30, 0, 15, 20, 20, 15, 0, -30],
  [-30, 5, 10, 15, 15, 10, 5, -30],
  [-40, -20, 0, 5, 5, 0, -20, -40],
  [-50, -40, -30, -30, -30, -30, -40, -50],
];

const bishopEvalWhite = [
  [-20, -10, -10, -10, -10, -10, -10, -20],
  [-10, 0, 0, 0, 0, 0, 0, -10],
  [-10, 0, 5, 10, 10, 5, 0, -10],
  [-10, 5, 5, 10, 10, 5, 5, -10],
  [-10, 0, 10, 10, 10, 10, 0, -10],
  [-10, 10, 10, 10, 10, 10, 10, -10],
  [-10, 5, 0, 0, 0, 0, 5, -10],
  [-20, -10, -10, -10, -10, -10, -10, -20],
];
const bishopEvalBlack = bishopEvalWhite.slice().reverse();

const rookEvalWhite = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [5, 10, 10, 10, 10, 10, 10, 5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [0, 0, 0, 5, 5, 0, 0, 0],
];
const rookEvalBlack = rookEvalWhite.slice().reverse();

const evalQueen = [
  [-20, -10, -10, -5, -5, -10, -10, -20],
  [-10, 0, 0, 0, 0, 0, 0, -10],
  [-10, 0, 5, 5, 5, 5, 0, -10],
  [-5, 0, 5, 5, 5, 5, 0, -5],
  [0, 0, 5, 5, 5, 5, 0, -5],
  [-10, 5, 5, 5, 5, 5, 0, -10],
  [-10, 0, 5, 0, 0, 0, 0, -10],
  [-20, -10, -10, -5, -5, -10, -10, -20],
];

const kingEvalWhite = [
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-20, -30, -30, -40, -40, -30, -30, -20],
  [-10, -20, -20, -20, -20, -20, -20, -10],
  [20, 20, 0, 0, 0, 0, 20, 20],
  [20, 30, 10, 0, 0, 10, 30, 20],
];
const kingEvalBlack = kingEvalWhite.slice().reverse();

export function evaluateBoard(game: Chess): number {
  let totalEvaluation = 0;
  const board = game.board();
  
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      totalEvaluation += getPieceValue(board[i][j], i, j);
    }
  }
  return totalEvaluation;
}

function getPieceValue(piece: { type: string; color: string } | null, x: number, y: number): number {
  if (piece === null) return 0;
  
  const getAbsoluteValue = function (pieceStr: string, isWhite: boolean, x: number, y: number) {
    if (pieceStr === 'p') {
      return 100 + (isWhite ? pawnEvalWhite[x][y] : pawnEvalBlack[x][y]);
    } else if (pieceStr === 'r') {
      return 500 + (isWhite ? rookEvalWhite[x][y] : rookEvalBlack[x][y]);
    } else if (pieceStr === 'n') {
      return 320 + knightEval[x][y];
    } else if (pieceStr === 'b') {
      return 330 + (isWhite ? bishopEvalWhite[x][y] : bishopEvalBlack[x][y]);
    } else if (pieceStr === 'q') {
      return 900 + evalQueen[x][y];
    } else if (pieceStr === 'k') {
      return 20000 + (isWhite ? kingEvalWhite[x][y] : kingEvalBlack[x][y]);
    }
    return 0;
  };

  const absVal = getAbsoluteValue(piece.type, piece.color === 'w', x, y);
  return piece.color === 'w' ? absVal : -absVal;
}

function minimaxRoot(depth: number, game: Chess, isMaximisingPlayer: boolean): Move | null {
  const newGameMoves = game.moves({ verbose: true });
  newGameMoves.sort(() => Math.random() - 0.5);

  let bestMove = isMaximisingPlayer ? -99999 : 99999;
  let bestMoveFound = newGameMoves[0] || null;

  for (let i = 0; i < newGameMoves.length; i++) {
    const newGameMove = newGameMoves[i];
    game.move(newGameMove);
    const value = minimax(depth - 1, game, -100000, 100000, !isMaximisingPlayer);
    game.undo();
    if (isMaximisingPlayer) {
      if (value > bestMove) {
        bestMove = value;
        bestMoveFound = newGameMove;
      }
    } else {
      if (value < bestMove) {
        bestMove = value;
        bestMoveFound = newGameMove;
      }
    }
  }
  return bestMoveFound;
}

function minimax(depth: number, game: Chess, alpha: number, beta: number, isMaximisingPlayer: boolean): number {
  if (depth === 0 || game.isGameOver()) {
    return evaluateBoard(game);
  }

  const newGameMoves = game.moves();

  if (isMaximisingPlayer) {
    let bestMove = -99999;
    for (let i = 0; i < newGameMoves.length; i++) {
      game.move(newGameMoves[i]);
      bestMove = Math.max(bestMove, minimax(depth - 1, game, alpha, beta, !isMaximisingPlayer));
      game.undo();
      alpha = Math.max(alpha, bestMove);
      if (beta <= alpha) {
        return bestMove;
      }
    }
    return bestMove;
  } else {
    let bestMove = 99999;
    for (let i = 0; i < newGameMoves.length; i++) {
      game.move(newGameMoves[i]);
      bestMove = Math.min(bestMove, minimax(depth - 1, game, alpha, beta, !isMaximisingPlayer));
      game.undo();
      beta = Math.min(beta, bestMove);
      if (beta <= alpha) {
        return bestMove;
      }
    }
    return bestMove;
  }
}

export function getBestMove(gameFen: string, depth = 3): Move | null {
  const compGame = new Chess(gameFen);
  if (compGame.isGameOver()) return null;
  const isWhite = compGame.turn() === 'w';
  const bestMove = minimaxRoot(depth, compGame, isWhite);
  return bestMove;
}
