import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native'
import { api, asRows, rowDetail, rowTitle, type Row } from './api'
import { DEMO_ACCOUNTS, flowsFor, formAllowed, roleLabel, type Flow } from './flows'
import { colors } from './theme'

export type Session = { base: string; token: string; name: string; role: string }

const LAN = 'https://calculation-jesse-flags-admission.trycloudflare.com'
const EMULATOR = 'http://10.0.2.2:3000'

export function LoginScreen({ onLogin }: { onLogin: (session: Session) => void }) {
  const [base, setBase] = useState(LAN)
  const [email, setEmail] = useState('demo.planner@vungu.test')
  const [password, setPassword] = useState('demo1234')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function signIn() {
    setBusy(true)
    setError('')
    try {
      const json = await api(base.trim(), '/api/auth/login', {
        method: 'POST',
        body: { email: email.trim(), password },
      }) as { data?: { token?: string; user?: { name?: string; role?: string } } }
      const token = json.data?.token
      const user = json.data?.user
      if (!token || !user?.role) throw new Error('The server did not return a session.')
      onLogin({ base: base.trim().replace(/\/$/, ''), token, name: user.name || email, role: user.role })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.login} keyboardShouldPersistTaps="handled">
        <Text style={styles.kicker}>Vungu Rural District Council</Text>
        <Text style={styles.h1}>Council desk</Text>
        <Text style={styles.lead}>
          Sign in with the same account you use on the council system. The phone must reach the server address below.
        </Text>
        <Field label="Server" value={base} onChangeText={setBase} autoCapitalize="none" />
        <View style={styles.chips}>
          <Chip label="This network" onPress={() => setBase(LAN)} />
          <Chip label="Emulator" onPress={() => setBase(EMULATOR)} />
        </View>
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry />
        <View style={styles.chips}>
          {DEMO_ACCOUNTS.map((account) => (
            <Chip key={account.email} label={account.label} onPress={() => setEmail(account.email)} />
          ))}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={styles.primary} onPress={signIn} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Sign in</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

export function DeskScreen({ session, onOpen, onLogout }: {
  session: Session
  onOpen: (flow: Flow) => void
  onLogout: () => void
}) {
  const flows = useMemo(() => flowsFor(session.role), [session.role])
  const [query, setQuery] = useState('')
  const shown = flows.filter((flow) => {
    const hay = `${flow.id} ${flow.title} ${flow.group}`.toLowerCase()
    return hay.includes(query.trim().toLowerCase())
  })
  const groups = [...new Set(shown.map((flow) => flow.group))]

  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>{roleLabel(session.role)}</Text>
          <Text style={styles.h2}>{session.name}</Text>
        </View>
        <Pressable onPress={onLogout}><Text style={styles.link}>Sign out</Text></Pressable>
      </View>
      <TextInput
        style={styles.search}
        placeholder="Search a flow"
        placeholderTextColor={colors.muted}
        value={query}
        onChangeText={setQuery}
      />
      <ScrollView contentContainerStyle={styles.list}>
        {groups.map((group) => (
          <View key={group}>
            <Text style={styles.group}>{group}</Text>
            {shown.filter((flow) => flow.group === group).map((flow) => (
              <Pressable key={flow.id} style={styles.card} onPress={() => onOpen(flow)}>
                <Text style={styles.cardId}>{flow.id}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{flow.title}</Text>
                  <Text style={styles.cardAbout} numberOfLines={2}>{flow.about}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

export function FlowScreen({ session, flow, onBack }: {
  session: Session
  flow: Flow
  onBack: () => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const showForm = !!flow.form && formAllowed(flow.form, session.role)

  useEffect(() => {
    const next: Record<string, string> = {}
    flow.form?.fields.forEach((field) => { next[field.key] = field.default ?? '' })
    setValues(next)
  }, [flow])

  async function load() {
    const path = flow.list(session.role)
    if (!path) {
      setRows([])
      setBusy(false)
      setError('')
      return
    }
    setBusy(true)
    setError('')
    try {
      const json = await api(session.base, path, { token: session.token })
      setRows(asRows(json).slice(0, 40))
    } catch (err) {
      setRows([])
      setError(err instanceof Error ? err.message : 'Could not load this flow')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { load() }, [flow.id])

  async function submit() {
    if (!flow.form) return
    const row = rows.find((item) => String(item.id) === selected) ?? null
    if (flow.form.needsRow && !row) {
      setNote('Select a record first.')
      return
    }
    setNote('')
    setBusy(true)
    try {
      const request = flow.form.submit(values, row)
      await api(session.base, request.path, { token: session.token, method: request.method, body: request.body })
      setNote('Saved.')
      await load()
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'The server refused that')
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.top}>
        <Pressable onPress={onBack}><Text style={styles.link}>Back</Text></Pressable>
        <Pressable onPress={load}><Text style={styles.link}>Refresh</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <Text style={styles.kicker}>{flow.id} · {flow.group}</Text>
        <Text style={styles.h2}>{flow.title}</Text>
        <Text style={styles.lead}>{flow.about}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {busy ? <ActivityIndicator color={colors.green} /> : null}
        {showForm && flow.form ? (
          <View style={styles.form}>
            <Text style={styles.formTitle}>{flow.form.legend}</Text>
            {flow.form.needsRow ? <Text style={styles.cardAbout}>Select a record below, then send.</Text> : null}
            {flow.form.fields.map((field) => (
              <Field
                key={field.key}
                label={field.label}
                placeholder={field.placeholder}
                value={values[field.key] ?? ''}
                onChangeText={(text) => setValues((current) => ({ ...current, [field.key]: text }))}
              />
            ))}
            <Pressable style={styles.primary} onPress={submit} disabled={busy}>
              <Text style={styles.primaryText}>Send</Text>
            </Pressable>
            {note ? <Text style={styles.note}>{note}</Text> : null}
          </View>
        ) : null}
        {rows.map((row, index) => {
          const id = String(row.id ?? index)
          const on = selected === id
          return (
            <Pressable key={id} style={[styles.card, on && styles.cardOn]} onPress={() => setSelected(id)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{rowTitle(row)}</Text>
                {rowDetail(row) ? <Text style={styles.cardAbout}>{rowDetail(row)}</Text> : null}
              </View>
            </Pressable>
          )
        })}
        {!busy && rows.length === 0 && !error ? <Text style={styles.lead}>Nothing is on this register yet.</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function Field(props: {
  label: string
  value: string
  onChangeText: (text: string) => void
  placeholder?: string
  secureTextEntry?: boolean
  autoCapitalize?: 'none' | 'sentences'
}) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={colors.muted}
        secureTextEntry={props.secureTextEntry}
        autoCapitalize={props.autoCapitalize ?? 'sentences'}
        autoCorrect={false}
      />
    </View>
  )
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.chip} onPress={onPress}>
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper, paddingTop: 42 },
  login: { padding: 20, paddingBottom: 48 },
  list: { padding: 16, paddingBottom: 48 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  kicker: { color: colors.green, fontSize: 13, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' },
  h1: { color: colors.ink, fontSize: 32, fontWeight: '700', marginTop: 4 },
  h2: { color: colors.ink, fontSize: 22, fontWeight: '700', marginTop: 2 },
  lead: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: 8, marginBottom: 12 },
  label: { color: colors.muted, fontSize: 12, marginBottom: 4 },
  input: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.ink, fontSize: 16 },
  search: { marginHorizontal: 16, backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { backgroundColor: colors.greenSoft, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { color: colors.green, fontWeight: '600' },
  primary: { backgroundColor: colors.green, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  error: { color: colors.danger, marginVertical: 8 },
  note: { color: colors.ink, marginTop: 8 },
  link: { color: colors.green, fontWeight: '700', padding: 8 },
  group: { color: colors.muted, fontSize: 13, fontWeight: '700', marginTop: 16, marginBottom: 8, textTransform: 'uppercase' },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 8, flexDirection: 'row', gap: 10, borderWidth: 1, borderColor: colors.line },
  cardOn: { borderColor: colors.green, backgroundColor: colors.greenSoft },
  cardId: { color: colors.green, fontWeight: '700', width: 36 },
  cardTitle: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  cardAbout: { color: colors.muted, marginTop: 2, lineHeight: 20 },
  form: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.line },
  formTitle: { color: colors.ink, fontWeight: '700', fontSize: 16, marginBottom: 8 },
})
