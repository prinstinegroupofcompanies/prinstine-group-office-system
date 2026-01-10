import React, { useState, useEffect, useRef } from 'react';

const RecipientSelector = ({ users, selectedRecipients, onRecipientsChange, placeholder = "To: Type name or email..." }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const inputRef = useRef(null);
  const suggestionsRef = useRef(null);

  useEffect(() => {
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const filtered = users.filter(user => {
        const name = (user.name || '').toLowerCase();
        const email = (user.email || '').toLowerCase();
        const role = (user.role || '').toLowerCase();
        return (name.includes(term) || email.includes(term) || role.includes(term)) &&
               !selectedRecipients.find(r => r.id === user.id);
      });
      setFilteredUsers(filtered.slice(0, 10)); // Limit to 10 suggestions
      setShowSuggestions(filtered.length > 0);
    } else {
      setFilteredUsers([]);
      setShowSuggestions(false);
    }
  }, [searchTerm, users, selectedRecipients]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(event.target) &&
          inputRef.current && !inputRef.current.contains(event.target)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e) => {
    setSearchTerm(e.target.value);
  };

  const handleSelectUser = (user) => {
    if (!selectedRecipients.find(r => r.id === user.id)) {
      onRecipientsChange([...selectedRecipients, user]);
    }
    setSearchTerm('');
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleRemoveRecipient = (userId) => {
    onRecipientsChange(selectedRecipients.filter(r => r.id !== userId));
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && filteredUsers.length > 0) {
      e.preventDefault();
      handleSelectUser(filteredUsers[0]);
    } else if (e.key === 'Backspace' && searchTerm === '' && selectedRecipients.length > 0) {
      handleRemoveRecipient(selectedRecipients[selectedRecipients.length - 1].id);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  return (
    <div className="recipient-selector" style={{ position: 'relative' }}>
      <div
        className="form-control d-flex flex-wrap align-items-center gap-2"
        style={{ minHeight: '42px', padding: '4px 8px', cursor: 'text' }}
        onClick={() => inputRef.current?.focus()}
      >
        {selectedRecipients.map(recipient => (
          <span
            key={recipient.id}
            className="badge bg-primary d-flex align-items-center gap-1"
            style={{ fontSize: '0.875rem', padding: '4px 8px' }}
          >
            {recipient.name || recipient.email}
            <button
              type="button"
              className="btn-close btn-close-white"
              style={{ fontSize: '0.6rem' }}
              onClick={(e) => {
                e.stopPropagation();
                handleRemoveRecipient(recipient.id);
              }}
            ></button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          className="border-0 flex-grow-1"
          style={{ outline: 'none', minWidth: '200px' }}
          value={searchTerm}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (searchTerm.trim() && filteredUsers.length > 0) {
              setShowSuggestions(true);
            }
          }}
          placeholder={selectedRecipients.length === 0 ? placeholder : ''}
        />
      </div>
      
      {showSuggestions && filteredUsers.length > 0 && (
        <div
          ref={suggestionsRef}
          className="list-group position-absolute w-100"
          style={{
            zIndex: 1000,
            maxHeight: '200px',
            overflowY: 'auto',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            border: '1px solid #dee2e6',
            borderRadius: '4px',
            marginTop: '2px',
            backgroundColor: 'white'
          }}
        >
          {filteredUsers.map(user => (
            <button
              key={user.id}
              type="button"
              className="list-group-item list-group-item-action"
              onClick={() => handleSelectUser(user)}
              style={{ textAlign: 'left' }}
            >
              <div className="d-flex flex-column">
                <strong>{user.name || 'Unknown'}</strong>
                <small className="text-muted">{user.email} - {user.role}</small>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default RecipientSelector;

