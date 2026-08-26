import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'

describe('undo probe', () => {
  it('lists commands', () => {
    const ed = new Editor({ extensions: [StarterKit], content: '# a' })
    const cmds = Object.keys(ed.commands).filter((k) => /undo|redo|clear/i.test(k))
    console.log('CMDS:', cmds)
    ed.commands.insertContent('X')
    console.log('canUndo:', ed.can().undo())
    ed.destroy()
    expect(true).toBe(true)
  })
})
