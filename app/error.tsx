"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Page error:", error);
  }, [error]);

  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="bg-white rounded-xl shadow-lg border border-red-200 p-8 max-w-lg w-full">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
            <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-900">Something went wrong</h2>
        </div>
        <p className="text-sm text-gray-600 mb-2">{error.message}</p>
        {error.digest && (
          <p className="text-xs text-gray-400 mb-4">Digest: {error.digest}</p>
        )}
        <pre className="text-xs bg-gray-50 rounded-lg p-3 mb-4 overflow-auto max-h-40 text-gray-500">
          {error.stack}
        </pre>
        <button
          onClick={reset}
          className="bg-iram-green text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-iram-green-dark transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
