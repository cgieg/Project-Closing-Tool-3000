export interface Role {
  id: string
  label: string
  funktion: string
  level: 'Expert' | 'Senior' | 'Intermediate' | 'Junior'
  organisation: 'Muster GmbH Deutschland' | 'Muster Delivery Center Spanien/Portugal'
}
