import { useNavigate } from 'react-router-dom';

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="pob-card mx-auto mt-12 max-w-4xl text-center">
      <div className="mb-6">
        <h1 className="mb-4 text-6xl font-bold text-pob-orange">404</h1>
        <h2 className="mb-2 text-2xl font-semibold">Iteration Not Found</h2>
        <p className="text-gray-400">The iteration you're looking for doesn't exist... yet!</p>
      </div>

      <div className="mb-8 border-t border-pob-orange/20 pt-8">
        <h3 className="mb-4 text-xl font-semibold text-pob-orange">🎮 While You Wait...</h3>
        <p className="mb-4 text-sm text-gray-400">
          Play 2048! Use arrow keys to combine tiles and reach 2048.
        </p>

        {/* Injected 2048 Game */}
        <div className="mx-auto" style={{ maxWidth: '600px' }}>
          <iframe
            src="/2048-game/game.html"
            title="2048 Game"
            className="mx-auto rounded-lg border-2 border-pob-orange/30"
            style={{
              width: '100%',
              height: '700px',
              border: 'none',
            }}
            allow="autoplay"
          />
        </div>
      </div>

      <div className="border-t border-pob-orange/20 pt-6">
        <button
          onClick={() => navigate('/')}
          className="pob-button"
        >
          ← Back to Home
        </button>
      </div>
    </div>
  );
}
