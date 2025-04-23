import { useEffect, useRef, useState } from 'react';
import { createClient, ConnectionProvider, useCursor, createStorageHooks } from '@collabblocks/react-sdk';

// For MVP, we'll use a simple local URL and room ID
const WS_URL = 'ws://localhost:8080';
const ROOM_ID = 'demo-room-1';
const TOKEN = 'dev-token';

// Random user ID for this session
const USER_ID = `user_${Math.floor(Math.random() * 10000)}`;

// Enable live storage
const { useLiveObject } = createStorageHooks();

function App() {
    const [connection, setConnection] = useState(null);

    // Initialize connection
    useEffect(() => {
        const client = createClient(WS_URL, ROOM_ID, TOKEN);
        setConnection(client);

        return () => {
            client?.disconnect();
        };
    }, []);

    if (!connection) {
        return <div>Connecting...</div>;
    }

    return (
        <ConnectionProvider value={connection}>
            <div className="container">
                <h1>CollabBlocks Demo</h1>
                <div className="users-container">
                    <div>You are: {USER_ID}</div>
                </div>
                <Editor />
            </div>
        </ConnectionProvider>
    );
}

function Editor() {
    const { cursor, otherCursors, setCursor } = useCursor();
    const [doc, updateDoc] = useLiveObject({ text: 'Type something here...' });
    const containerRef = useRef<HTMLDivElement>(null);

    // Handle mouse movement
    const handleMouseMove = (e: React.MouseEvent) => {
        if (!containerRef.current) return;

        const rect = containerRef.current.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;

        setCursor(x, y);
    };

    // Handle text change
    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        updateDoc({ text: e.target.value });
    };

    return (
        <div
            className="editor-container"
            ref={containerRef}
            onMouseMove={handleMouseMove}
        >
            {/* Other users' cursors */}
            {otherCursors.map((user) => (
                user.cursor && (
                    <div
                        key={user.userId}
                        className="cursor"
                        data-name={user.userId}
                        style={{
                            left: `${user.cursor.x * 100}%`,
                            top: `${user.cursor.y * 100}%`,
                            backgroundColor: stringToColor(user.userId),
                        }}
                    />
                )
            ))}

            {/* Text editor */}
            <textarea
                value={doc.text}
                onChange={handleTextChange}
                placeholder="Start typing..."
            />
        </div>
    );
}

// Helper to generate a color from a string
function stringToColor(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }

    const hue = hash % 360;
    return `hsl(${hue}, 70%, 50%)`;
}

export default App; 