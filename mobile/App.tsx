import { useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import type { Flow } from './src/flows'
import { DeskScreen, FlowScreen, LoginScreen, type Session } from './src/screens'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [flow, setFlow] = useState<Flow | null>(null)

  return (
    <>
      <StatusBar style="dark" />
      {!session ? <LoginScreen onLogin={setSession} /> : null}
      {session && !flow ? (
        <DeskScreen session={session} onOpen={setFlow} onLogout={() => { setSession(null); setFlow(null) }} />
      ) : null}
      {session && flow ? <FlowScreen session={session} flow={flow} onBack={() => setFlow(null)} /> : null}
    </>
  )
}
