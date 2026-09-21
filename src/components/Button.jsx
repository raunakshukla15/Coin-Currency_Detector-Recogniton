export default function Button({ children, variant = 'primary', size = 'md', className = '', as, ...props }) {
  const Comp = as || 'button'
  return (
    <Comp
      className={`btn btn-${variant} btn-${size} ${className}`}
      {...props}
    >
      {children}
    </Comp>
  )
}