import { useId, useRef, useState } from 'react'
import { Icon } from '../components/Icon'

type Props = {
  title: string
  hint: string
  accept?: string
  multiple?: boolean
  disabled?: boolean
  onFiles: (files: File[]) => void
}

export function DropZone({ title, hint, accept, multiple = true, disabled = false, onFiles }: Props) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const take = (list: FileList | null) => {
    if (!list || list.length === 0 || disabled) return
    onFiles(Array.from(list))
  }

  return (
    <label
      htmlFor={inputId}
      className={`dropzone${over ? ' is-over' : ''}${disabled ? ' is-disabled' : ''}`}
      onDragOver={event => {
        event.preventDefault()
        if (!disabled) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={event => {
        event.preventDefault()
        setOver(false)
        take(event.dataTransfer.files)
      }}
    >
      <span className="dropzone-icon"><Icon name="upload" size={22} /></span>
      <span className="dropzone-title">{title}</span>
      <span className="dropzone-hint">{hint}</span>
      <input
        ref={inputRef}
        id={inputId}
        className="visually-hidden"
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={event => {
          take(event.currentTarget.files)
          // Cho phép chọn lại đúng file vừa chọn.
          if (inputRef.current) inputRef.current.value = ''
        }}
      />
    </label>
  )
}
